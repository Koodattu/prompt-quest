import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, asc, avg, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { db } from "./db";
import {
  aiAttempts,
  aiLevelCompletions,
  aiLevels,
  appSettings,
  passwordGroups,
  questionnaireResponses,
  sessions
} from "./db/schema";
import { migrateAndSeed } from "./db/migrate";
import { createAdminToken, verifyAdminToken, verifyPasswordGroup } from "./lib/auth";
import { checkRateLimit } from "./lib/rate-limit";
import { detectSuccess, Provider, streamAiResponse } from "./lib/llm";

const app = new Hono();
const score = z.number().int().min(1).max(5);

app.use(
  "*",
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"]
  })
);

const loginSchema = z.object({
  password: z.string().min(1).max(200),
  sessionId: z.string().min(8).max(120).optional()
});

const questionnaireSchema = z.object({
  sessionId: z.string().min(8).max(120),
  presentationScore: score,
  imageAppScore: score,
  codeAppScore: score,
  aiFeelingScore: score,
  freeText: z.string().max(2000).optional()
});

const chatSchema = z.object({
  sessionId: z.string().min(8).max(120),
  levelId: z.string().min(1).max(120),
  message: z.string().min(1).max(2000)
});

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

async function getSession(sessionId: string) {
  const [session] = await db
    .select({
      id: sessions.id,
      passwordGroupId: sessions.passwordGroupId,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      groupLabel: passwordGroups.label
    })
    .from(sessions)
    .innerJoin(passwordGroups, eq(passwordGroups.id, sessions.passwordGroupId))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return session ?? null;
}

async function requireCompletedQuestionnaire(sessionId: string) {
  const [response] = await db
    .select({ id: questionnaireResponses.id })
    .from(questionnaireResponses)
    .where(eq(questionnaireResponses.sessionId, sessionId))
    .limit(1);
  return Boolean(response);
}

async function getProvider(): Promise<Provider> {
  const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "ai_provider")).limit(1);
  const value = setting?.value;
  return value === "openai" || value === "mock" || value === "google" ? value : "google";
}

async function assertAdmin(authorization: string | undefined) {
  const token = verifyAdminToken(authorization);
  if (!token) return null;
  const [group] = await db
    .select()
    .from(passwordGroups)
    .where(and(eq(passwordGroups.id, token.sub), eq(passwordGroups.isAdmin, true), eq(passwordGroups.isActive, true)))
    .limit(1);
  return group ?? null;
}

app.get("/health", (c) => c.json({ ok: true }));

app.post("/api/login", async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json());
  if (!parsed.success) return jsonError("Invalid login request");

  const group = await verifyPasswordGroup(parsed.data.password, false);
  if (!group) return jsonError("Wrong or inactive password", 401);

  const sessionId = parsed.data.sessionId ?? randomUUID();
  await db
    .insert(sessions)
    .values({
      id: sessionId,
      passwordGroupId: group.id,
      userAgent: c.req.header("user-agent") ?? null
    })
    .onConflictDoUpdate({
      target: sessions.id,
      set: {
        passwordGroupId: group.id,
        lastSeenAt: new Date(),
        userAgent: c.req.header("user-agent") ?? null
      }
    });

  return c.json({
    sessionId,
    group: { id: group.id, label: group.label },
    questionnaireCompleted: await requireCompletedQuestionnaire(sessionId)
  });
});

app.get("/api/session", async (c) => {
  const sessionId = c.req.query("sessionId");
  if (!sessionId) return jsonError("Missing sessionId");
  const session = await getSession(sessionId);
  if (!session) return jsonError("Unknown session", 404);
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
  return c.json({
    sessionId: session.id,
    groupLabel: session.groupLabel,
    questionnaireCompleted: await requireCompletedQuestionnaire(sessionId)
  });
});

app.post("/api/questionnaire", async (c) => {
  const parsed = questionnaireSchema.safeParse(await c.req.json());
  if (!parsed.success) return jsonError("Invalid questionnaire");

  const session = await getSession(parsed.data.sessionId);
  if (!session) return jsonError("Unknown session", 404);

  await db
    .insert(questionnaireResponses)
    .values({
      id: randomUUID(),
      sessionId: parsed.data.sessionId,
      presentationScore: parsed.data.presentationScore,
      imageAppScore: parsed.data.imageAppScore,
      codeAppScore: parsed.data.codeAppScore,
      aiFeelingScore: parsed.data.aiFeelingScore,
      freeText: parsed.data.freeText?.trim() || null
    })
    .onConflictDoUpdate({
      target: questionnaireResponses.sessionId,
      set: {
        presentationScore: parsed.data.presentationScore,
        imageAppScore: parsed.data.imageAppScore,
        codeAppScore: parsed.data.codeAppScore,
        aiFeelingScore: parsed.data.aiFeelingScore,
        freeText: parsed.data.freeText?.trim() || null
      }
    });

  return c.json({ ok: true });
});

app.get("/api/levels", async (c) => {
  const sessionId = c.req.query("sessionId");
  if (!sessionId) return jsonError("Missing sessionId");
  if (!(await getSession(sessionId))) return jsonError("Unknown session", 404);
  if (!(await requireCompletedQuestionnaire(sessionId))) return jsonError("Questionnaire required", 403);

  const levels = await db.select().from(aiLevels).where(eq(aiLevels.isActive, true)).orderBy(asc(aiLevels.difficulty));
  const completions = await db
    .select({ levelId: aiLevelCompletions.levelId })
    .from(aiLevelCompletions)
    .where(eq(aiLevelCompletions.sessionId, sessionId));
  const completed = new Set(completions.map((item) => item.levelId));

  return c.json({
    levels: levels.map((level, index) => ({
      id: level.id,
      nameFi: level.nameFi,
      nameEn: level.nameEn,
      difficulty: level.difficulty,
      model: level.model,
      hintFi: level.hintFi,
      hintEn: level.hintEn,
      completed: completed.has(level.id),
      unlocked: index === 0 || completed.has(level.id) || completed.has(levels[index - 1]?.id)
    }))
  });
});

app.post("/api/chat", async (c) => {
  const parsed = chatSchema.safeParse(await c.req.json());
  if (!parsed.success) return jsonError("Invalid chat request");
  if (!checkRateLimit(parsed.data.sessionId)) return jsonError("Too many chat requests. Please wait a moment.", 429);
  if (!(await getSession(parsed.data.sessionId))) return jsonError("Unknown session", 404);
  if (!(await requireCompletedQuestionnaire(parsed.data.sessionId))) return jsonError("Questionnaire required", 403);

  const [level] = await db.select().from(aiLevels).where(eq(aiLevels.id, parsed.data.levelId)).limit(1);
  if (!level || !level.isActive) return jsonError("Unknown level", 404);

  const provider = await getProvider();
  const encoder = new TextEncoder();
  let fullResponse = "";
  const requestId = randomUUID();

  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          for await (const token of streamAiResponse(provider, level, parsed.data.message, { requestId })) {
            fullResponse += token;
            controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token })}\n\n`));
          }
          const wasSuccessful = detectSuccess(fullResponse, level.hiddenPassword, level.successPhrase);
          await db.insert(aiAttempts).values({
            id: randomUUID(),
            sessionId: parsed.data.sessionId,
            levelId: parsed.data.levelId,
            userPrompt: parsed.data.message,
            aiResponse: fullResponse,
            wasSuccessful
          });
          controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ wasSuccessful })}\n\n`));
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI request failed";
          console.error(
            JSON.stringify({
              event: "ai.chat.error",
              at: new Date().toISOString(),
              requestId,
              provider,
              levelId: level.id,
              model: level.model,
              message
            })
          );
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`));
        } finally {
          controller.close();
        }
      }
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    }
  );
});

app.post("/api/levels/:id/unlock", async (c) => {
  const body = z.object({ sessionId: z.string(), password: z.string().min(1).max(200) }).safeParse(await c.req.json());
  if (!body.success) return jsonError("Invalid unlock request");
  const levelId = c.req.param("id");
  const [level] = await db.select().from(aiLevels).where(eq(aiLevels.id, levelId)).limit(1);
  if (!level) return jsonError("Unknown level", 404);
  if (body.data.password.trim().toLowerCase() !== level.hiddenPassword.toLowerCase()) {
    return jsonError("Wrong level password", 401);
  }
  const [successfulAttempt] = await db
    .select({ id: aiAttempts.id })
    .from(aiAttempts)
    .where(
      and(
        eq(aiAttempts.sessionId, body.data.sessionId),
        eq(aiAttempts.levelId, levelId),
        eq(aiAttempts.wasSuccessful, true)
      )
    )
    .limit(1);
  if (!successfulAttempt) return jsonError("Make the AI reveal the password first", 403);

  await db
    .insert(aiLevelCompletions)
    .values({
      id: randomUUID(),
      sessionId: body.data.sessionId,
      levelId,
      enteredPassword: body.data.password.trim()
    })
    .onConflictDoNothing();

  return c.json({ ok: true });
});

app.post("/api/admin/login", async (c) => {
  const parsed = loginSchema.pick({ password: true }).safeParse(await c.req.json());
  if (!parsed.success) return jsonError("Invalid login request");
  const group = await verifyPasswordGroup(parsed.data.password, true);
  if (!group) return jsonError("Wrong admin password", 401);
  return c.json({ token: createAdminToken(group.id), label: group.label });
});

app.use("/api/admin/*", async (c, next) => {
  const admin = await assertAdmin(c.req.header("authorization"));
  if (!admin) return jsonError("Unauthorized", 401);
  await next();
});

app.get("/api/admin/settings", async (c) => {
  const settings = await db.select().from(appSettings);
  return c.json({ settings: Object.fromEntries(settings.map((item) => [item.key, item.value])) });
});

app.patch("/api/admin/settings", async (c) => {
  const body = z.object({ aiProvider: z.enum(["google", "openai", "mock"]) }).safeParse(await c.req.json());
  if (!body.success) return jsonError("Invalid settings");
  await db
    .insert(appSettings)
    .values({ key: "ai_provider", value: body.data.aiProvider })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: body.data.aiProvider, updatedAt: new Date() } });
  return c.json({ ok: true });
});

app.get("/api/admin/stats", async (c) => {
  const [sessionCount] = await db.select({ value: count() }).from(sessions);
  const [responseCount] = await db.select({ value: count() }).from(questionnaireResponses);
  const [attemptCount] = await db.select({ value: count() }).from(aiAttempts);
  const [recentSessionCount] = await db
    .select({ value: count() })
    .from(sessions)
    .where(sql`${sessions.lastSeenAt} > now() - interval '15 minutes'`);
  const [averages] = await db
    .select({
      presentation: avg(questionnaireResponses.presentationScore),
      imageApp: avg(questionnaireResponses.imageAppScore),
      codeApp: avg(questionnaireResponses.codeAppScore),
      aiFeeling: avg(questionnaireResponses.aiFeelingScore)
    })
    .from(questionnaireResponses);
  const levelStats = await db
    .select({
      levelId: aiLevels.id,
      nameFi: aiLevels.nameFi,
      nameEn: aiLevels.nameEn,
      attempts: count(aiAttempts.id),
      successes: sql<number>`count(${aiAttempts.id}) filter (where ${aiAttempts.wasSuccessful} = true)`,
      completions: sql<number>`count(distinct ${aiLevelCompletions.id})`
    })
    .from(aiLevels)
    .leftJoin(aiAttempts, eq(aiAttempts.levelId, aiLevels.id))
    .leftJoin(aiLevelCompletions, eq(aiLevelCompletions.levelId, aiLevels.id))
    .groupBy(aiLevels.id)
    .orderBy(asc(aiLevels.difficulty));

  return c.json({
    totals: {
      sessions: sessionCount.value,
      recentSessions: recentSessionCount.value,
      responses: responseCount.value,
      attempts: attemptCount.value
    },
    averages,
    levelStats
  });
});

app.get("/api/admin/responses", async (c) => {
  const groupId = c.req.query("groupId");
  const rows = await db
    .select({
      id: questionnaireResponses.id,
      sessionId: questionnaireResponses.sessionId,
      groupId: passwordGroups.id,
      groupLabel: passwordGroups.label,
      presentationScore: questionnaireResponses.presentationScore,
      imageAppScore: questionnaireResponses.imageAppScore,
      codeAppScore: questionnaireResponses.codeAppScore,
      aiFeelingScore: questionnaireResponses.aiFeelingScore,
      freeText: questionnaireResponses.freeText,
      createdAt: questionnaireResponses.createdAt
    })
    .from(questionnaireResponses)
    .innerJoin(sessions, eq(sessions.id, questionnaireResponses.sessionId))
    .innerJoin(passwordGroups, eq(passwordGroups.id, sessions.passwordGroupId))
    .where(groupId ? eq(passwordGroups.id, groupId) : isNotNull(questionnaireResponses.id))
    .orderBy(desc(questionnaireResponses.createdAt))
    .limit(500);
  return c.json({ responses: rows });
});

app.get("/api/admin/attempts", async (c) => {
  const rows = await db
    .select({
      id: aiAttempts.id,
      sessionId: aiAttempts.sessionId,
      groupLabel: passwordGroups.label,
      levelId: aiAttempts.levelId,
      levelNameFi: aiLevels.nameFi,
      levelNameEn: aiLevels.nameEn,
      userPrompt: aiAttempts.userPrompt,
      aiResponse: aiAttempts.aiResponse,
      wasSuccessful: aiAttempts.wasSuccessful,
      createdAt: aiAttempts.createdAt
    })
    .from(aiAttempts)
    .innerJoin(sessions, eq(sessions.id, aiAttempts.sessionId))
    .innerJoin(passwordGroups, eq(passwordGroups.id, sessions.passwordGroupId))
    .innerJoin(aiLevels, eq(aiLevels.id, aiAttempts.levelId))
    .orderBy(desc(aiAttempts.createdAt))
    .limit(500);
  return c.json({ attempts: rows });
});

app.get("/api/admin/passwords", async (c) => {
  const rows = await db
    .select({
      id: passwordGroups.id,
      label: passwordGroups.label,
      isAdmin: passwordGroups.isAdmin,
      isActive: passwordGroups.isActive,
      createdAt: passwordGroups.createdAt
    })
    .from(passwordGroups)
    .orderBy(desc(passwordGroups.createdAt));
  return c.json({ passwords: rows });
});

app.post("/api/admin/passwords", async (c) => {
  const body = z
    .object({
      label: z.string().min(1).max(120),
      password: z.string().min(4).max(200),
      isAdmin: z.boolean().default(false)
    })
    .safeParse(await c.req.json());
  if (!body.success) return jsonError("Invalid password group");
  await db.insert(passwordGroups).values({
    id: randomUUID(),
    label: body.data.label,
    passwordHash: await bcrypt.hash(body.data.password, 12),
    isAdmin: body.data.isAdmin,
    isActive: true
  });
  return c.json({ ok: true });
});

app.patch("/api/admin/passwords/:id", async (c) => {
  const body = z
    .object({
      label: z.string().min(1).max(120).optional(),
      password: z.string().min(4).max(200).optional(),
      isActive: z.boolean().optional()
    })
    .safeParse(await c.req.json());
  if (!body.success) return jsonError("Invalid password update");
  await db
    .update(passwordGroups)
    .set({
      ...(body.data.label ? { label: body.data.label } : {}),
      ...(body.data.password ? { passwordHash: await bcrypt.hash(body.data.password, 12) } : {}),
      ...(body.data.isActive === undefined ? {} : { isActive: body.data.isActive })
    })
    .where(eq(passwordGroups.id, c.req.param("id")));
  return c.json({ ok: true });
});

app.get("/api/admin/levels", async (c) => {
  const levels = await db.select().from(aiLevels).orderBy(asc(aiLevels.difficulty));
  return c.json({ levels });
});

app.post("/api/admin/levels", async (c) => {
  const body = z
    .object({
      nameFi: z.string().min(1),
      nameEn: z.string().min(1),
      difficulty: z.number().int().min(1),
      hiddenPassword: z.string().min(1),
      successPhrase: z.string().optional(),
      systemPrompt: z.string().min(1),
      model: z.string().min(1),
      hintFi: z.string().optional(),
      hintEn: z.string().optional()
    })
    .safeParse(await c.req.json());
  if (!body.success) return jsonError("Invalid level");
  await db.insert(aiLevels).values({ id: randomUUID(), ...body.data, successPhrase: body.data.successPhrase || null });
  return c.json({ ok: true });
});

app.patch("/api/admin/levels/:id", async (c) => {
  const body = z
    .object({
      nameFi: z.string().min(1).optional(),
      nameEn: z.string().min(1).optional(),
      difficulty: z.number().int().min(1).optional(),
      hiddenPassword: z.string().min(1).optional(),
      successPhrase: z.string().nullable().optional(),
      systemPrompt: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      hintFi: z.string().nullable().optional(),
      hintEn: z.string().nullable().optional(),
      isActive: z.boolean().optional()
    })
    .safeParse(await c.req.json());
  if (!body.success) return jsonError("Invalid level update");
  await db.update(aiLevels).set(body.data).where(eq(aiLevels.id, c.req.param("id")));
  return c.json({ ok: true });
});

await migrateAndSeed();

const port = Number(process.env.PORT ?? 4000);
export default {
  port,
  fetch: app.fetch
};

console.log(`PromptQuest API listening on http://localhost:${port}`);
