'use strict';

/**
 * Determines whether the Herzstück (Hz) is beweglich (moving) or starr (fixed).
 *
 * Rules:
 *   - herzstückbauart === 0  → starr (no Hz-beweglich TPs)
 *   - herzstückbauart >= 1   → check federwippe flag
 *   - federwippe + bauart>=1 → beweglich
 *
 * NRB_W806: federwippe=true, herzstückbauart=2 → beweglich ✓
 * NI_W2006: herzstückbauart=0                  → starr    ✓
 */
function deriveHzBeweglich({ federwippe, herzstückbauart }) {
  const bauart = parseInt(herzstückbauart, 10);
  if (isNaN(bauart) || bauart === 0) {
    return { hzBeweglich: false };
  }
  // bauart >= 1: beweglich if federwippe is true
  return { hzBeweglich: bauart >= 1 && federwippe === true };
}

module.exports = { deriveHzBeweglich };
