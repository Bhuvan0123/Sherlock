/**
 * Shared vocabulary for every analysis result.
 *
 * A hard rule runs through this layer: measured Azure DevOps data and generated
 * interpretation are never mixed together silently. Every analysis result carries
 * a `facts` block (counted from the Azure DevOps REST API) and separate
 * `observations` / `concerns` / `recommendations` blocks that are explicitly
 * labelled as generated analysis.
 */

/** Health vocabulary used for project dimensions. */
export type HealthRating = 'Good' | 'Moderate Risk' | 'At Risk' | 'High Risk';

/** Risk vocabulary used for individual items and deadlines. */
export type RiskLevel = 'Low Risk' | 'Medium Risk' | 'High Risk';

export const ANALYSIS_DISCLAIMER =
    'AI-GENERATED ANALYSIS. The `facts` section is measured directly from the Azure DevOps REST API. The observations, concerns, risk ratings and recommendations are heuristic interpretations produced by this MCP server, not statements of fact and not a performance evaluation of any individual. Every rating lists the rule that produced it so it can be checked. Nothing here changes Azure DevOps.';

export const READ_ONLY_NOTE =
    'Recommendations are advisory only. This server cannot modify Azure DevOps; apply any change directly in Azure DevOps.';

export interface RatedDimension {
    rating: HealthRating;
    /** The measured values and the threshold rule that produced the rating. */
    reasons: string[];
}

export interface AnalysisEnvelope<TFacts> {
    kind: string;
    generatedAt: string;
    dataSource: string;
    /** Measured Azure DevOps values. */
    facts: TFacts;
    /** Generated interpretation. */
    observations: string[];
    concerns: string[];
    recommendations: string[];
    /** How the ratings were computed, in plain language. */
    methodology: string[];
    disclaimer: string;
    readOnlyNote: string;
}

export function buildEnvelope<TFacts>(
    kind: string,
    facts: TFacts,
    parts: {
        observations?: string[];
        concerns?: string[];
        recommendations?: string[];
        methodology?: string[];
        dataSource?: string;
    } = {}
): AnalysisEnvelope<TFacts> {
    return {
        kind,
        generatedAt: new Date().toISOString(),
        dataSource: parts.dataSource ?? 'Azure DevOps REST API (live read)',
        facts,
        observations: parts.observations ?? [],
        concerns: parts.concerns ?? [],
        recommendations: parts.recommendations ?? [],
        methodology: parts.methodology ?? [],
        disclaimer: ANALYSIS_DISCLAIMER,
        readOnlyNote: READ_ONLY_NOTE
    };
}

/** Picks the worst rating from a set, for rolling dimensions up into an overall view. */
export function worstRating(ratings: HealthRating[]): HealthRating {
    const order: HealthRating[] = ['Good', 'Moderate Risk', 'At Risk', 'High Risk'];
    return ratings.reduce<HealthRating>((worst, rating) => (order.indexOf(rating) > order.indexOf(worst) ? rating : worst), 'Good');
}

export function worstRisk(risks: RiskLevel[]): RiskLevel {
    const order: RiskLevel[] = ['Low Risk', 'Medium Risk', 'High Risk'];
    return risks.reduce<RiskLevel>((worst, risk) => (order.indexOf(risk) > order.indexOf(worst) ? risk : worst), 'Low Risk');
}

/** Compact work-item reference used throughout analysis output. */
export interface ItemRef {
    id: number;
    type: string;
    title: string;
    state: string;
    assignedTo: string | null;
    dueDate: string | null;
    webUrl: string | null;
}

export function toItemRef(item: {
    id: number;
    type: string;
    title: string;
    state: string;
    assignedTo: string | null;
    dueDate: string | null;
    targetDate?: string | null;
    webUrl: string | null;
}): ItemRef {
    return {
        id: item.id,
        type: item.type,
        title: item.title,
        state: item.state,
        assignedTo: item.assignedTo,
        dueDate: item.dueDate ?? item.targetDate ?? null,
        webUrl: item.webUrl
    };
}
