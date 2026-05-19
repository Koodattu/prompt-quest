import { relations, sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const passwordGroups = pgTable("password_groups", {
  id: text("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  label: text("label").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  passwordGroupId: text("password_group_id").notNull().references(() => passwordGroups.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  userAgent: text("user_agent")
});

export const questionnaireResponses = pgTable(
  "questionnaire_responses",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => sessions.id),
    presentationScore: integer("presentation_score").notNull(),
    imageAppScore: integer("image_app_score").notNull(),
    codeAppScore: integer("code_app_score").notNull(),
    aiFeelingScore: integer("ai_feeling_score").notNull(),
    freeText: text("free_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    sessionIdx: uniqueIndex("questionnaire_responses_session_idx").on(table.sessionId)
  })
);

export const aiLevels = pgTable("ai_levels", {
  id: text("id").primaryKey(),
  nameFi: text("name_fi").notNull(),
  nameEn: text("name_en").notNull(),
  difficulty: integer("difficulty").notNull(),
  hiddenPassword: text("hidden_password").notNull(),
  successPhrase: text("success_phrase"),
  systemPrompt: text("system_prompt").notNull(),
  model: text("model").notNull(),
  hintFi: text("hint_fi"),
  hintEn: text("hint_en"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const aiAttempts = pgTable("ai_attempts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  levelId: text("level_id").notNull().references(() => aiLevels.id),
  userPrompt: text("user_prompt").notNull(),
  aiResponse: text("ai_response").notNull(),
  wasSuccessful: boolean("was_successful").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const aiLevelCompletions = pgTable(
  "ai_level_completions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => sessions.id),
    levelId: text("level_id").notNull().references(() => aiLevels.id),
    enteredPassword: text("entered_password").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    sessionLevelIdx: uniqueIndex("ai_level_completions_session_level_idx").on(table.sessionId, table.levelId)
  })
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`)
});

export const passwordGroupsRelations = relations(passwordGroups, ({ many }) => ({
  sessions: many(sessions)
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  passwordGroup: one(passwordGroups, {
    fields: [sessions.passwordGroupId],
    references: [passwordGroups.id]
  }),
  questionnaireResponses: many(questionnaireResponses),
  aiAttempts: many(aiAttempts)
}));
