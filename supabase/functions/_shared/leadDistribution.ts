import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface RoutingRule {
  id?: string;
  name?: string;
  email?: string;
  enabled?: boolean;
  active?: boolean;
  weight?: number;
}

export interface DistributionConfig {
  mode?: string;
  default_assignee?: string;
  round_robin_index?: number;
  user_rules?: RoutingRule[];
}

function filterActiveRules(rules: RoutingRule[] = []): RoutingRule[] {
  return rules.filter((r) => r && r.enabled !== false && r.active !== false);
}

export function pickWeightedRule(activeRules: RoutingRule[]): RoutingRule | null {
  const weighted = activeRules.filter((r) => Number(r.weight) > 0);
  const sumWeight = weighted.reduce((acc, r) => acc + Number(r.weight), 0);
  if (weighted.length === 0 || sumWeight <= 0) return null;

  const rand = Math.random() * sumWeight;
  let running = 0;
  for (const r of weighted) {
    running += Number(r.weight);
    if (rand <= running) return r;
  }
  return weighted[0];
}

function resolveFromConfig(
  dist: DistributionConfig,
  fallbackAssignee = "unassigned"
): { assignee: string; nextRoundRobinIndex?: number } {
  const mode = dist.mode || "round_robin";
  const defaultAssignee = dist.default_assignee || fallbackAssignee || "unassigned";
  const activeRules = filterActiveRules(dist.user_rules || []);

  if (mode === "unassigned") {
    return { assignee: "unassigned" };
  }
  if (mode === "single") {
    return { assignee: defaultAssignee };
  }
  if (mode === "round_robin") {
    if (activeRules.length > 0) {
      const idx = Number(dist.round_robin_index || 0);
      const selected = activeRules[idx % activeRules.length];
      return {
        assignee: selected?.name || selected?.email || defaultAssignee,
        nextRoundRobinIndex: idx + 1,
      };
    }
    return { assignee: defaultAssignee };
  }
  if (mode === "weighted") {
    const chosen = pickWeightedRule(activeRules);
    return {
      assignee: chosen?.name || chosen?.email || defaultAssignee,
    };
  }

  return { assignee: defaultAssignee };
}

/**
 * Resolves the next assignee strictly scoped to a single company's form, pipeline,
 * or global company routing configuration (never falling back to hardcoded user names).
 */
export async function resolveCompanyLeadAssignee(params: {
  adminClient: SupabaseClient;
  companyId: string;
  connectedForm?: Record<string, any> | null;
  pipelineId?: string | null;
  logPrefix?: string;
}): Promise<string> {
  const { adminClient, companyId, connectedForm, pipelineId, logPrefix = "[LeadDistribution]" } = params;

  // 1. Form-level allocation override (when explicitly configured)
  const allocationMode = connectedForm?.allocation_mode || "inherit_global";
  if (connectedForm && allocationMode !== "inherit_global") {
    if (allocationMode === "specific_user") {
      return connectedForm.assigned_to || "unassigned";
    }
    if (allocationMode === "unassigned") {
      return "unassigned";
    }
    const rules = Array.isArray(connectedForm.user_rules) ? connectedForm.user_rules : [];
    if ((allocationMode === "round_robin" || allocationMode === "weighted") && rules.length > 0) {
      const resolved = resolveFromConfig({
        mode: allocationMode,
        default_assignee: connectedForm.assigned_to || "unassigned",
        round_robin_index: connectedForm.round_robin_index || 0,
        user_rules: rules,
      });

      if (resolved.nextRoundRobinIndex !== undefined && connectedForm.id) {
        try {
          await adminClient
            .from("connected_forms")
            .update({
              round_robin_index: resolved.nextRoundRobinIndex,
              updated_at: new Date().toISOString(),
            })
            .eq("id", connectedForm.id)
            .eq("company_id", companyId);
        } catch (err) {
          console.warn(`${logPrefix} Failed updating form round_robin_index:`, err);
        }
      }
      return resolved.assignee;
    }
  }

  // 2. Pipeline-level lead distribution (scoped by company_id)
  if (pipelineId) {
    try {
      const { data: pipeData } = await adminClient
        .from("pipelines")
        .select("lead_distribution")
        .eq("id", pipelineId)
        .eq("company_id", companyId)
        .maybeSingle();

      if (pipeData?.lead_distribution && typeof pipeData.lead_distribution === "object") {
        const pDist = pipeData.lead_distribution as DistributionConfig;
        const resolved = resolveFromConfig(pDist);
        if (resolved.nextRoundRobinIndex !== undefined) {
          await adminClient
            .from("pipelines")
            .update({
              lead_distribution: { ...pDist, round_robin_index: resolved.nextRoundRobinIndex },
              updated_at: new Date().toISOString(),
            })
            .eq("id", pipelineId)
            .eq("company_id", companyId);
        }
        return resolved.assignee;
      }
    } catch (err) {
      console.warn(`${logPrefix} Failed resolving pipeline lead_distribution:`, err);
    }
  }

  // 3. Company-wide lead_routing_config fallback (strictly scoped by company_id)
  try {
    const { data: routingConfig } = await adminClient
      .from("lead_routing_config")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (routingConfig) {
      const resolved = resolveFromConfig({
        mode: routingConfig.mode,
        default_assignee: routingConfig.default_assignee,
        round_robin_index: routingConfig.round_robin_index,
        user_rules: routingConfig.user_rules || [],
      });

      if (resolved.nextRoundRobinIndex !== undefined) {
        await adminClient
          .from("lead_routing_config")
          .update({
            round_robin_index: resolved.nextRoundRobinIndex,
            updated_at: new Date().toISOString(),
          })
          .eq("id", routingConfig.id)
          .eq("company_id", companyId);
      }
      return resolved.assignee;
    }
  } catch (err) {
    console.warn(`${logPrefix} Failed resolving company lead_routing_config:`, err);
  }

  return "unassigned";
}

