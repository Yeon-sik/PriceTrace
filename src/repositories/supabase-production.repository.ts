import type { QualityFlag } from "@/domain/production";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export class SupabaseProductionRepository {
  async createQualityFlags(documentId: string, flags: QualityFlag[]) {
    const client = getSupabaseBrowserClient();
    if (!client || flags.length === 0) return;
    const { data } = await client.auth.getUser();
    if (!data.user) return;
    const { error } = await client.from("receipt_quality_flags").insert(
      flags.map((flag) => ({
        user_id: data.user.id,
        document_id: documentId,
        flag_type: flag.type,
        severity: flag.severity,
        details: flag.details,
      })),
    );
    if (error) throw error;
  }

  async writeAuditLog(input: {
    action: string;
    entityType: string;
    entityId?: string;
    targetUserId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { data } = await client.auth.getUser();
    if (!data.user) return;
    const { error } = await client.from("audit_logs").insert({
      actor_user_id: data.user.id,
      target_user_id: input.targetUserId ?? data.user.id,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) throw error;
  }
}
