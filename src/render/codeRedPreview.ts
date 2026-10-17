/** Local A/B diagnostics only; compiled to false in production. */
export const legacyModelPreview = import.meta.env.DEV && typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('model-baseline') === '1';
