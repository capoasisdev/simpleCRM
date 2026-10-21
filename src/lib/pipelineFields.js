export const DEFAULT_PIPELINE_FIELDS = [
  { key: 'name', label: 'Full Name', mapped_question: 'name', show_on_card: false, is_core: true },
  { key: 'phone', label: 'Phone Number', mapped_question: 'phone', show_on_card: true, is_core: true },
  { key: 'email', label: 'Email Address', mapped_question: 'email', show_on_card: false, is_core: true },
  { key: 'city', label: 'City', mapped_question: 'city', show_on_card: false, is_core: false }
];

/**
 * Returns the effective fields for a pipeline, falling back to default core fields
 */
export function getPipelineFields(pipeline) {
  if (pipeline && Array.isArray(pipeline.pipeline_fields) && pipeline.pipeline_fields.length > 0) {
    return pipeline.pipeline_fields;
  }
  return DEFAULT_PIPELINE_FIELDS;
}

/**
 * Normalizes a field label into a clean alphanumeric snake_case key
 */
export function labelToKey(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Resolves the displayed value for a pipeline field on a lead
 */
export function getLeadFieldValue(lead, field) {
  if (!lead || !field) return '';

  // Core properties
  if (field.key === 'name') return lead.name || '';
  if (field.key === 'phone') return lead.phone || '';
  if (field.key === 'email') return lead.email || '';
  if (field.key === 'city') {
    return lead.city || lead.custom_fields?.['City'] || lead.custom_fields?.['city'] || '';
  }

  // Check mapped question first
  if (field.mapped_question && lead.custom_fields) {
    if (lead.custom_fields[field.mapped_question] !== undefined && lead.custom_fields[field.mapped_question] !== null) {
      return lead.custom_fields[field.mapped_question];
    }
  }

  // Fallbacks: field.key or field.label in custom_fields or lead direct property
  if (lead.custom_fields) {
    if (lead.custom_fields[field.key] !== undefined && lead.custom_fields[field.key] !== null) {
      return lead.custom_fields[field.key];
    }
    if (lead.custom_fields[field.label] !== undefined && lead.custom_fields[field.label] !== null) {
      return lead.custom_fields[field.label];
    }
  }

  if (lead[field.key] !== undefined && lead[field.key] !== null) {
    return lead[field.key];
  }

  return '';
}

/**
 * Collects all unique form questions / field keys submitted across leads in a pipeline
 */
export function extractPipelineFormQuestions(pipelineLeads) {
  const questionsSet = new Set();
  (pipelineLeads || []).forEach((lead) => {
    if (lead.custom_fields && typeof lead.custom_fields === 'object') {
      Object.keys(lead.custom_fields).forEach((q) => {
        if (q && q.trim()) questionsSet.add(q.trim());
      });
    }
  });
  return Array.from(questionsSet);
}
