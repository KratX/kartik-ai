import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default('Kartik Rawat'),
  avatarUrl: text('avatar_url'),
  planId: text('plan_id').notNull().default('plan_free'),
  availableCredits: integer('available_credits').notNull().default(250),
  reservedCredits: integer('reserved_credits').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const conversations = pgTable('conversations', {
  conversationId: text('conversation_id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  deletionState: text('deletion_state').notNull().default('active'),
  messageCount: integer('message_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  messageId: text('message_id').primaryKey(),
  conversationId: text('conversation_id')
    .references(() => conversations.conversationId, { onDelete: 'cascade' })
    .notNull(),
  userUid: text('user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  agentUsed: text('agent_used'),
  requestId: text('request_id'),
  creditsCharged: integer('credits_charged').default(0),
  idempotentReplay: boolean('idempotent_replay').default(false),
  citationsJson: jsonb('citations_json').notNull().default([]),
  searchImagesJson: jsonb('search_images_json').notNull().default([]),
  artifactIdsJson: jsonb('artifact_ids_json').notNull().default([]),
  attachedFileIdsJson: jsonb('attached_file_ids_json').notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const uploadedFiles = pgTable('uploaded_files', {
  fileId: text('file_id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  conversationId: text('conversation_id').notNull(),
  originalFilename: text('original_filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  sha256Hex: text('sha256_hex').notNull(),
  pageCount: integer('page_count'),
  chunkCount: integer('chunk_count').notNull().default(0),
  status: text('status').notNull().default('ready'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const artifacts = pgTable('artifacts', {
  artifactId: text('artifact_id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  requestId: text('request_id').notNull().unique(),
  conversationId: text('conversation_id').notNull(),
  artifactType: text('artifact_type').notNull(),
  title: text('title').notNull(),
  entryFile: text('entry_file').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  filesManifestJson: jsonb('files_manifest_json').notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const creditLedgerEntries = pgTable('credit_ledger_entries', {
  entryId: text('entry_id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  requestId: text('request_id').notNull(),
  description: text('description').notNull(),
  deltaCredits: integer('delta_credits').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const paymentOrders = pgTable('payment_orders', {
  orderId: text('order_id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  planId: text('plan_id').notNull(),
  requestId: text('request_id').notNull(),
  amountPaise: integer('amount_paise').notNull(),
  creditsGranted: integer('credits_granted').notNull(),
  paymentId: text('payment_id'),
  settled: boolean('settled').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const privateObjects = pgTable('private_objects', {
  storageKey: text('storage_key').primaryKey(),
  ownerUserUid: text('owner_user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256Hex: text('sha256_hex').notNull(),
  contentBase64: text('content_base64').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
  messages: many(messages),
  uploadedFiles: many(uploadedFiles),
  artifacts: many(artifacts),
  ledgerEntries: many(creditLedgerEntries),
  paymentOrders: many(paymentOrders),
  privateObjects: many(privateObjects),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  owner: one(users, {
    fields: [conversations.userUid],
    references: [users.uid],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.conversationId],
  }),
  owner: one(users, {
    fields: [messages.userUid],
    references: [users.uid],
  }),
}));
