import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName = '',
  avatarUrl: string | null = null,
) {
  try {
    const existing = await getUserByUid(uid);
    const normalizedEmail = email.trim().toLowerCase();
    const isSyntheticEmail =
      !normalizedEmail ||
      normalizedEmail === `${uid.toLowerCase()}@kartik.ai` ||
      normalizedEmail === 'guest@local.kartik.ai';

    if (existing) {
      const nextEmail =
        !isSyntheticEmail && normalizedEmail ? normalizedEmail : existing.email;
      const nextDisplayName =
        displayName.trim() && displayName.trim() !== uid
          ? displayName.trim()
          : existing.displayName;
      const nextAvatarUrl =
        avatarUrl !== null && avatarUrl !== undefined
          ? avatarUrl
          : existing.avatarUrl;

      if (
        nextEmail === existing.email &&
        nextDisplayName === existing.displayName &&
        nextAvatarUrl === existing.avatarUrl
      ) {
        return existing;
      }

      const updated = await db
        .update(users)
        .set({
          email: nextEmail,
          displayName: nextDisplayName,
          avatarUrl: nextAvatarUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.uid, uid))
        .returning();

      return updated[0] ?? existing;
    }

    const result = await db
      .insert(users)
      .values({
        uid,
        email: normalizedEmail || `${uid}@kartik.ai`,
        displayName: displayName.trim() || uid,
        avatarUrl,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0]!;
  } catch (error) {
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function getUserByUid(uid: string) {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}
