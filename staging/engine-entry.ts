// Hosting adapter exports the delivered STEP 10 implementation unchanged.
export { listItems, getItem, resolve } from '../product-engine/src/api/crm-handlers';
export { authorize, errorResponse, jsonResponse } from '../product-engine/src/api/http';
export { loadCatalogSnapshot } from '../product-engine/src/db/catalog-snapshot';
export { loadPresentations } from '../product-engine/src/db/crm-api-deps';
