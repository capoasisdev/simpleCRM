export const DEFAULT_PIPELINE_FIELDS = [
  { key: 'name', label: 'Full Name', mapped_question: 'name', show_on_card: false, is_core: true },
  { key: 'phone', label: 'Phone Number', mapped_question: 'phone', show_on_card: true, is_core: true },
  { key: 'email', label: 'Email Address', mapped_question: 'email', show_on_card: false, is_core: true },
  { key: 'city', label: 'City', mapped_question: 'city', show_on_card: false, is_core: false }
];

export const DEFAULT_COLD_PIPELINE_FIELDS = [
  { key: 'name', label: 'Full Name', mapped_question: 'name', show_on_card: false, is_core: true },
  { key: 'company', label: 'Company', mapped_question: 'company', show_on_card: true, is_core: false },
  { key: 'designation', label: 'Job Title / Designation', mapped_question: 'designation', show_on_card: true, is_core: false },
  { key: 'phone', label: 'Phone Number', mapped_question: 'phone', show_on_card: false, is_core: true },
  { key: 'email', label: 'Email Address', mapped_question: 'email', show_on_card: false, is_core: true },
  { key: 'linkedin', label: 'LinkedIn Profile', mapped_question: 'linkedin', show_on_card: false, is_core: false }
];

export const DEFAULT_COLD_B2C_PIPELINE_FIELDS = [
  { key: 'name', label: 'Full Name / Member', mapped_question: 'name', show_on_card: false, is_core: true },
  { key: 'interest', label: 'Inquiry & Need', mapped_question: 'interest', show_on_card: true, is_core: false },
  { key: 'persona', label: 'Customer Persona', mapped_question: 'persona', show_on_card: true, is_core: false },
  { key: 'city', label: 'City / Location', mapped_question: 'city', show_on_card: true, is_core: false },
  { key: 'phone', label: 'Phone Number', mapped_question: 'phone', show_on_card: false, is_core: true },
  { key: 'email', label: 'Email Address', mapped_question: 'email', show_on_card: false, is_core: true }
];

export const STANDARD_DISCOVERY_ATTRIBUTES = [
  { value: 'name', label: 'Full Name' },
  { value: 'company', label: 'Company' },
  { value: 'designation', label: 'Job Title / Designation' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'email', label: 'Email Address' },
  { value: 'city', label: 'City' },
  { value: 'address', label: 'Street Address' },
  { value: 'website', label: 'Website' },
  { value: 'category', label: 'Business Category' },
  { value: 'rating', label: 'Google Rating' },
  { value: 'review_count', label: 'Review Count' },
  { value: 'google_maps_url', label: 'Google Maps Link' },
  { value: 'linkedin', label: 'LinkedIn Profile' }
];

/**
 * Returns the effective fields for a pipeline, falling back to default core fields
 */
export function getPipelineFields(pipeline, pipelineType = 'sales') {
  if (pipeline && Array.isArray(pipeline.pipeline_fields) && pipeline.pipeline_fields.length > 0) {
    return pipeline.pipeline_fields;
  }
  const effectiveType = pipeline?.pipeline_type || pipelineType;
  if (effectiveType === 'cold') {
    const isB2C = pipeline?.discovery_config?.target_mode === 'b2c';
    return isB2C ? DEFAULT_COLD_B2C_PIPELINE_FIELDS : DEFAULT_COLD_PIPELINE_FIELDS;
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

  const targetKey = field.mapped_question || field.key;

  // Direct lead properties
  if (targetKey === 'name') return lead.name || '';
  if (targetKey === 'phone') return lead.phone || '';
  if (targetKey === 'email') return lead.email || '';
  if (targetKey === 'city') {
    return lead.city || lead.custom_fields?.['City'] || lead.custom_fields?.['city'] || lead.custom_fields?.location || '';
  }
  if (targetKey === 'company') {
    return lead.company || lead.custom_fields?.company || '';
  }
  if (targetKey === 'designation') {
    return lead.designation || lead.custom_fields?.designation || '';
  }
  if (targetKey === 'website') {
    return lead.website || lead.custom_fields?.website || '';
  }
  if (targetKey === 'interest') {
    return lead.custom_fields?.interest || lead.custom_fields?.requirement || lead.designation || '';
  }
  if (targetKey === 'persona') {
    return lead.custom_fields?.persona || (lead.custom_fields?.target_mode === 'b2c' ? lead.designation : '') || '';
  }

  // Check mapped question in custom_fields
  if (field.mapped_question && lead.custom_fields) {
    if (lead.custom_fields[field.mapped_question] !== undefined && lead.custom_fields[field.mapped_question] !== null) {
      return lead.custom_fields[field.mapped_question];
    }
  }

  // Fallbacks: targetKey or field.key or field.label in custom_fields or lead direct property
  if (lead.custom_fields) {
    if (lead.custom_fields[targetKey] !== undefined && lead.custom_fields[targetKey] !== null) {
      return lead.custom_fields[targetKey];
    }
    if (lead.custom_fields[field.key] !== undefined && lead.custom_fields[field.key] !== null) {
      return lead.custom_fields[field.key];
    }
    if (lead.custom_fields[field.label] !== undefined && lead.custom_fields[field.label] !== null) {
      return lead.custom_fields[field.label];
    }
  }

  if (lead[targetKey] !== undefined && lead[targetKey] !== null) {
    return lead[targetKey];
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
