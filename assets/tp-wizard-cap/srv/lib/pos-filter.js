'use strict';

/**
 * Filters ForlaTemplate entries by basic form (Grundbauform).
 * Uses BasicFormMapping posNrFrom/posNrTo ranges to restrict relevant TPs.
 */
function filterByBasicForm(basicForm, forlaTemplates, basicFormMappings) {
  const mappings = basicFormMappings.filter(m => m.basicForm === basicForm);
  if (!mappings || mappings.length === 0) {
    // If no specific mapping, return all templates valid for this basic form
    return forlaTemplates.filter(t => {
      try {
        const forms = JSON.parse(t.basicForms || '[]');
        return forms.includes(basicForm);
      } catch {
        return true;
      }
    });
  }

  return forlaTemplates.filter(t => {
    const posNr = parseInt(t.posNr, 10);
    const inRange = mappings.some(m => posNr >= m.posNrFrom && posNr <= m.posNrTo);
    if (!inRange) return false;
    try {
      const forms = JSON.parse(t.basicForms || '[]');
      return forms.includes(basicForm);
    } catch {
      return true;
    }
  });
}

module.exports = { filterByBasicForm };
