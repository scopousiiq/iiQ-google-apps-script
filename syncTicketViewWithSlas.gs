/**
 * Google Apps Script helper that pulls ticket data from an Incident IQ view and
 * writes SLA-focused details into the "Devices/Hardware" tab.
 *
 * Endpoints covered (per /openapi specs):
 *   - POST /api/v1.0/tickets?$p=$i&$s=20          -> paginate tickets filtered by view facet
 *   - POST /api/v1.0/tickets/slas?$p=$i&$s=100    -> batch fetch SLA data for all tickets using ticketId filters
 */
const INCIDENT_IQ_CONFIG = {
  /**
   * Subdomain portion of the Incident IQ tenant URL (https://{subdomain}.incidentiq.com).
   * Leave blank until configured in the Project's script properties or constant.
   */
  subdomain: '',
  /**
   * GUID of the active site. Injected into the SiteId header for every API call.
   */
  siteId: '',
  /**
   * API (Bearer) token with rights to call the ticket/slas endpoints.
   */
  apiToken: '',
  /**
   * Pagination size for both ticket and SLA API calls.
   */
  pageSize: 1000,
  /**
   * When true, limits the result set to debugLimit records for testing.
   */
  debugMode: false,
  /**
   * Maximum records to fetch when debugMode is enabled.
   */
  debugLimit: 100,
  /**
   * Name of the config sheet containing sheet configurations.
   * Expected columns: Sheet Name (A), Ticket Type ID(s) (B), View ID (C), Tags (D), Start Row (E), Start Column (F)
   */
  configSheetName: 'Config'
};

/**
 * Main entrypoint to sync all configured sheets.
 */
function syncAllConfiguredSheets() {
  debugLog_('Starting syncAllConfiguredSheets...');
  validateApiConfig_();
  debugLog_('API config validation passed.');

  const configSheet = SpreadsheetApp.getActive().getSheetByName(INCIDENT_IQ_CONFIG.configSheetName);
  if (!configSheet) {
    throw new Error(`Config sheet "${INCIDENT_IQ_CONFIG.configSheetName}" was not found.`);
  }
  debugLog_(`Found config sheet: ${INCIDENT_IQ_CONFIG.configSheetName}`);

  const configs = readSheetConfigurations_(configSheet);
  debugLog_(`Read ${configs.length} sheet configurations from config sheet.`);

  let successCount = 0;
  let failureCount = 0;

  configs.forEach((config, index) => {
    try {
      debugLog_(`\n[${index + 1}/${configs.length}] Processing: ${config.sheetName}...`);
      syncSheetWithConfig(config);
      successCount++;
    } catch (error) {
      failureCount++;
      console.error(`Failed to sync ${config.sheetName}: ${error.message}`);
      debugLog_(`Error syncing ${config.sheetName}: ${error.message}`);
      // Continue processing other sheets even if one fails
    }
  });

  debugLog_(`\nsyncAllConfiguredSheets complete: ${successCount} succeeded, ${failureCount} failed.`);
}

/**
 * Syncs a single sheet with the provided configuration.
 * @param {Object} config - Configuration object with sheetName, ticketTypeIds, viewId, tags, startRow, startColumn
 */
function syncSheetWithConfig(config) {
  debugLog_(`Starting sync for sheet: ${config.sheetName}`);

  const sheet = SpreadsheetApp.getActive().getSheetByName(config.sheetName);
  if (!sheet) {
    throw new Error(`Sheet "${config.sheetName}" was not found in the active spreadsheet.`);
  }
  debugLog_(`Found sheet: ${config.sheetName}`);

  // Step 1: Gather all tickets from the view using view facet filter
  debugLog_(`Step 1: Fetching tickets from view ${config.viewId}...`);
  if (config.ticketTypeIds.length > 0) {
    debugLog_(`  Filtering by ticket types: ${config.ticketTypeIds.join(', ')}`);
  }
  if (config.tags.length > 0) {
    debugLog_(`  Filtering by tags: ${config.tags.join(', ')}`);
  }
  if (INCIDENT_IQ_CONFIG.debugMode) {
    debugLog_(`  DEBUG MODE: Limiting results to ${INCIDENT_IQ_CONFIG.debugLimit} records.`);
  }
  const allTickets = [];
  let pageIndex = 0;
  while (true) {
    debugLog_(`  Fetching ticket page ${pageIndex}...`);
    const ticketPage = searchTicketsByView_(config.viewId, config.ticketTypeIds, config.tags, pageIndex, INCIDENT_IQ_CONFIG.pageSize);
    const items = Array.isArray(ticketPage?.Items) ? ticketPage.Items : [];
    debugLog_(`  Page ${pageIndex} returned ${items.length} tickets.`);
    
    if (!items.length && pageIndex === 0) {
      debugLog_('No tickets found in view.');
      break; // nothing to sync
    }

    allTickets.push(...items);

    // Exit early if debug mode is enabled and we've reached the limit
    if (INCIDENT_IQ_CONFIG.debugMode && allTickets.length >= INCIDENT_IQ_CONFIG.debugLimit) {
      allTickets.splice(INCIDENT_IQ_CONFIG.debugLimit);
      debugLog_(`  DEBUG MODE: Reached limit of ${INCIDENT_IQ_CONFIG.debugLimit} records. Stopping ticket fetch.`);
      break;
    }

    if (!hasMorePages_(ticketPage, INCIDENT_IQ_CONFIG.pageSize)) {
      break;
    }

    pageIndex += 1;
    Utilities.sleep(250); // light throttle to avoid slamming the API.
  }
  debugLog_(`Step 1 complete: Fetched ${allTickets.length} total tickets.`);

  // Step 2: Fetch SLA data for all tickets using ticketId filters
  debugLog_('Step 2: Fetching SLA data for all tickets...');
  const slaLookup = allTickets.length > 0 ? fetchSlasForTickets_(allTickets) : {};
  debugLog_(`Step 2 complete: Fetched SLA data for ${Object.keys(slaLookup).length} tickets.`);

  // Step 3: Build rows and write to spreadsheet
  debugLog_('Step 3: Building spreadsheet rows...');
  const rows = allTickets.map(ticket => buildSheetRow_(ticket, slaLookup));
  debugLog_(`Step 3 complete: Built ${rows.length} rows.`);

  debugLog_('Clearing destination range and writing data to spreadsheet...');
  clearDestination_(sheet, config);
  if (rows.length) {
    sheet
      .getRange(config.startRow, config.startColumn, rows.length, 7)
      .setValues(rows);
    debugLog_(`Successfully wrote ${rows.length} rows to spreadsheet.`);
  }
  debugLog_(`Sync completed successfully for ${config.sheetName}.`);
}

/**
 * Logs a message to console only if debug mode is enabled.
 */
function debugLog_(message) {
  if (INCIDENT_IQ_CONFIG.debugMode) {
    console.log(message); // Use console directly here since this IS the debug gate
  }
}

/**
 * Ensures critical API config tokens are populated prior to running the sync.
 */
function validateApiConfig_() {
  debugLog_('Validating API configuration...');
  const missing = Object.entries({
    subdomain: INCIDENT_IQ_CONFIG.subdomain,
    siteId: INCIDENT_IQ_CONFIG.siteId,
    apiToken: INCIDENT_IQ_CONFIG.apiToken
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    const errorMsg = `Configure INCIDENT_IQ_CONFIG (${missing.join(', ')}) before running the sync.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  debugLog_('All API configuration values present.');
}

/**
 * Reads sheet configurations from the Config sheet.
 * Expected columns: A=Sheet Name, B=Ticket Type ID(s) (optional, CSV for multiple), C=View ID, D=Tags (optional, CSV for multiple), E=Start Row, F=Start Column
 * @returns {Array} Array of configuration objects
 */
function readSheetConfigurations_(configSheet) {
  const data = configSheet.getDataRange().getValues();
  const configs = [];

  // Skip header row (index 0), process remaining rows
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const sheetName = row[0]?.toString().trim();
    const ticketTypeIdsRaw = row[1]?.toString().trim() || '';
    const viewId = row[2]?.toString().trim();
    const tagsRaw = row[3]?.toString().trim() || '';
    const startRow = row[4] ? parseInt(row[4]) : 2;
    const startColumn = row[5] ? parseInt(row[5]) : 5;

    // Skip empty rows
    if (!sheetName) {
      continue;
    }

    // Validate required fields (only viewId is required now)
    if (!viewId) {
      throw new Error(`Row ${i + 1}: View ID is required for sheet "${sheetName}".`);
    }

    // Parse comma-separated ticket type IDs and trim each
    const ticketTypeIds = ticketTypeIdsRaw
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);

    // Parse comma-separated tags and trim each
    const tags = tagsRaw
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);

    configs.push({
      sheetName,
      ticketTypeIds,
      viewId,
      tags,
      startRow,
      startColumn
    });
  }

  return configs;
}

/**
 * Issues POST /api/v1.0/tickets with a view facet filter and pagination controls.
 * The tickettype and tag facets are optional and will be omitted if not provided.
 * @param {string} viewId - The view ID to filter by
 * @param {Array} ticketTypeIds - Array of ticket type IDs (can be empty)
 * @param {Array} tags - Array of tag values (can be empty)
 * @param {number} pageIndex - Current page index
 * @param {number} pageSize - Number of records per page
 */
function searchTicketsByView_(viewId, ticketTypeIds, tags, pageIndex, pageSize) {
  const query = buildQueryString_({ $p: pageIndex, $s: pageSize, $o: 'TicketClosedDate ASC' });
  const filters = [
    {
      Facet: 'view',
      Id: viewId,
      Selected: true
    }
  ];

  // Add tickettype facet for each ticket type ID provided
  if (Array.isArray(ticketTypeIds) && ticketTypeIds.length > 0) {
    ticketTypeIds.forEach(ticketTypeId => {
      filters.push({
        Facet: 'tickettype',
        Id: ticketTypeId
      });
    });
  }

  // Add tag facet for each tag provided
  if (Array.isArray(tags) && tags.length > 0) {
    tags.forEach(tag => {
      filters.push({
        Facet: 'tag',
        Id: tag
      });
    });
  }

  const requestBody = {
    Filters: filters
  };
  debugLog_(`  API: POST /api/v1.0/tickets${query}`);
  return incidentIqRequest_(`/api/v1.0/tickets${query}`, 'post', requestBody);
}

/**
 * POST /api/v1.0/tickets/slas with ticket ID filters to fetch SLA data for all tickets.
 * Builds a minimal GetTicketsRequest with ticketId facet filters for each ticket.
 * Paginates through all SLA responses using the configured pageSize and returns a { [ticketId]: sla } map for quick lookup.
 */
function fetchSlasForTickets_(tickets) {
  debugLog_(`Fetching SLA data for ${tickets.length} tickets...`);
  const slaLookup = {};
  if (!tickets || tickets.length === 0) {
    debugLog_('No tickets provided, returning empty SLA lookup.');
    return slaLookup;
  }

  // Build SLA request body with TicketNumber filters for each ticket
  const filters = tickets.map(ticket => ({
    Facet: 'TicketNumber',
    Id: ticket.TicketId
  }));

  const slaRequestBody = {
    Filters: filters
  };

  // Paginate through SLA data using POST /api/v1.0/tickets/slas
  let pageIndex = 0;
  let totalSlasRetrieved = 0;
  const expectedTicketCount = tickets.length;
  while (true) {
    const query = buildQueryString_({ $p: pageIndex, $s: INCIDENT_IQ_CONFIG.pageSize, $o: 'TicketClosedDate ASC' });
    debugLog_(`  Fetching SLA page ${pageIndex} with ${INCIDENT_IQ_CONFIG.pageSize} records per page...`);
    const response = incidentIqRequest_(`/api/v1.0/tickets/slas${query}`, 'post', slaRequestBody);
    const slaItems = Array.isArray(response?.Items) ? response.Items : [];
    debugLog_(`  SLA page ${pageIndex} returned ${slaItems.length} items.`);

    if (!slaItems.length && pageIndex === 0) {
      debugLog_('No SLA data available.');
      break; // no SLA data available
    }

    // Map SLA data by TicketId for quick lookup
    slaItems.forEach(slaItem => {
      // The SLA response contains the ticket identifier - try multiple possible field names
      const ticketId = slaItem?.TicketId || slaItem?.Id || slaItem?.TicketNumber;
      if (ticketId && !slaLookup[ticketId]) {
        slaLookup[ticketId] = slaItem;
        totalSlasRetrieved++;
      }
    });

    // Stop when we have SLA data for all tickets
    if (Object.keys(slaLookup).length >= expectedTicketCount) {
      debugLog_(`  Collected SLA data for all ${expectedTicketCount} tickets.`);
      break;
    }

    if (!hasMorePages_(response, INCIDENT_IQ_CONFIG.pageSize)) {
      break;
    }

    pageIndex += 1;
    Utilities.sleep(200);
  }
  debugLog_(`SLA fetch complete: Retrieved ${totalSlasRetrieved} SLA records for ${Object.keys(slaLookup).length} unique tickets.`);

  return slaLookup;
}

/**
 * Builds a single spreadsheet row using SLA + ticket values.
 */
function buildSheetRow_(ticket, slaLookup) {
  const slaDetails = slaLookup[ticket?.TicketId] || ticket?.Sla || null;
  const resolutionTime = deriveResolutionTime_(ticket, slaDetails);

  const closedDate = ticket?.ClosedDate ? formatDateForSheet_(ticket.ClosedDate) : '';
  const assignedTo = ticket?.AssignedToUser?.Name || '';
  const location = ticket?.Location?.Name || '';
  const priority = typeof ticket?.Priority === 'number' ? ticket.Priority : ticket?.Priority || '';
  const issue = ticket?.Issue?.Name || ticket?.Issue?.IssueCategoryName || '';
  const ticketLabel = ticket?.Subject || '';

  return [resolutionTime, closedDate, assignedTo, location, priority, issue, ticketLabel];
}

/**
 * Attempts to read a resolution time target from SLA details and actual time from SlaTimes.
 * Returns formatted string like "Sla: < 2 Days / Actual: 0.07 Days"
 */
function deriveResolutionTime_(ticket, slaDetails) {
  if (!slaDetails) {
    return '';
  }

  // Extract SLA target (Resolution Time metric - typically the first metric)
  let slaTargetDays = null;
  if (slaDetails?.Sla?.Metrics && Array.isArray(slaDetails.Sla.Metrics)) {
    // Find the Resolution Time metric (Name field contains "Resolution")
    const resolutionMetric = slaDetails.Sla.Metrics.find(m => m.Name && m.Name.includes('Resolution'));
    if (resolutionMetric) {
      slaTargetDays = resolutionMetric.Value; // e.g., 5 Days
    }
  }

  // Extract actual resolution time from SlaTimes (convert minutes to days)
  let actualDays = null;
  if (slaDetails?.SlaTimes && Array.isArray(slaDetails.SlaTimes)) {
    const resolutionTime = slaDetails.SlaTimes.find(st => st.Name && st.Name.includes('Resolution'));
    if (resolutionTime && typeof resolutionTime.LogMinutes === 'number') {
      actualDays = resolutionTime.LogMinutes / (60 * 24); // Convert minutes to days
    }
  }

  let result = '';
  if (slaTargetDays !== null) {
    result += `Sla: < ${slaTargetDays} Days`;
  }
  if (actualDays !== null) {
    if (result) result += ' / ';
    result += `Actual: ${actualDays.toFixed(2)} Days`;
  }

  return result;
}

/**
 * Formats a date for display in a spreadsheet cell.
 */
function formatDateForSheet_(dateStr) {
  try {
    const date = new Date(dateStr);
    return Utilities.formatDate(date, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'M/d/yyyy');
  } catch (e) {
    return dateStr || '';
  }
}

/**
 * Checks if there are more pages in the paginated response.
 */
function hasMorePages_(response, pageSize) {
  const totalRecords = response?.TotalRecordCount ?? response?.TotalCount ?? 0;
  const itemCount = Array.isArray(response?.Items) ? response.Items.length : 0;
  return itemCount >= pageSize && itemCount > 0;
}

/**
 * Clears the destination range in the spreadsheet.
 */
function clearDestination_(sheet, config) {
  // Clear a large range starting at the start position to ensure we clean up old data
  const maxClearRows = 10000;
  const rangeToClear = sheet.getRange(config.startRow, config.startColumn, maxClearRows, 7);
  rangeToClear.clearContent();
}

/**
 * Makes a request to the Incident IQ API with proper authentication headers.
 */
function incidentIqRequest_(pathWithQuery, method, body) {
  const url = `https://${INCIDENT_IQ_CONFIG.subdomain}.incidentiq.com${pathWithQuery}`;
  const options = {
    method: method.toUpperCase(),
    headers: {
      Authorization: `Bearer ${INCIDENT_IQ_CONFIG.apiToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      SiteId: INCIDENT_IQ_CONFIG.siteId,
      Client: 'GoogleAppsScript'
    },
    muteHttpExceptions: true
  };

  if (body) {
    options.payload = JSON.stringify(body);
  }

  const response = UrlFetchApp.fetch(url, options);
  const status = response.getResponseCode();
  if (status >= 300) {
    const errorText = response.getContentText();
    console.error(`Incident IQ request failed (${status}): ${errorText}`);
    throw new Error(`Incident IQ request failed (${status}): ${errorText}`);
  }

  const content = response.getContentText();
  return content ? JSON.parse(content) : {};
}

/**
 * Builds a query string from an object of parameters.
 */
function buildQueryString_(params) {
  const filtered = Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null);
  if (!filtered.length) {
    return '';
  }

  const query = filtered
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `?${query}`;
}

/**
 * Fetches all available ticket types from the Incident IQ API.
 * Uses GET /api/v1.0/tickets/wizards endpoint.
 * @returns {Array} Array of ticket type objects with Id (TicketWizardCategoryId) and Name properties
 */
function fetchAllTicketTypes_() {
  console.log('Fetching ticket types from GET /api/v1.0/tickets/wizards...');
  
  const response = incidentIqRequest_('/api/v1.0/tickets/wizards', 'get', null);
  
  // Extract ticket types from the response - Items is at root level
  const ticketTypes = [];
  if (Array.isArray(response?.Items)) {
    response.Items.forEach(ticketType => {
      ticketTypes.push({
        Id: ticketType.TicketWizardCategoryId,
        Name: ticketType.Name
      });
    });
  }

  console.log(`Extracted ${ticketTypes.length} ticket types.`);
  return ticketTypes;
}

/**
 * Fetches all available tags from the Incident IQ API.
 * Uses POST /api/v1.0/tags/query endpoint.
 * @returns {Array} Array of tag objects with Id (TagId) and Name properties
 */
function fetchAllTags_() {
  console.log('Fetching tags from POST /api/v1.0/tags/query...');
  
  const response = incidentIqRequest_('/api/v1.0/tags/query', 'post', {});
  
  const tags = [];
  if (Array.isArray(response?.Items)) {
    response.Items.forEach(tag => {
      tags.push({
        Id: tag.TagId,
        Name: tag.Name
      });
    });
  }

  console.log(`Extracted ${tags.length} tags.`);
  return tags;
}

/**
 * Entrypoint to fetch and populate the "Ticket Types" sheet if it exists.
 * Can be run independently without executing the full sync.
 */
function populateTicketTypeReference() {
  console.log('Starting populateTicketTypeReference...');
  
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Ticket Types');
  
  if (!sheet) {
    console.log('Ticket Types sheet not found. Skipping population.');
    return;
  }
  
  validateApiConfig_();
  console.log('API config validation passed.');

  try {
    const ticketTypes = fetchAllTicketTypes_();
    console.log(`Fetched ${ticketTypes.length} ticket types.`);

    writeTicketTypesToSheet_(sheet, ticketTypes);
    console.log('Ticket types written to "Ticket Types" sheet.');
  } catch (error) {
    console.error(`Failed to populate ticket types: ${error.message}`);
    throw error;
  }
}

/**
 * Writes ticket types to the provided sheet with formatted headers and data.
 * @param {Sheet} sheet - The sheet to populate
 * @param {Array} ticketTypes - Array of ticket type objects
 */
function writeTicketTypesToSheet_(sheet, ticketTypes) {
  // Clear existing data
  sheet.clear();
  
  // Write header row
  const headerRow = ['Name', 'ID'];
  sheet.getRange(1, 1, 1, 2).setValues([headerRow]);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  sheet.getRange(1, 1, 1, 2).setBackground('#D3D3D3');

  // Write ticket type data
  if (ticketTypes.length > 0) {
    const dataRows = ticketTypes.map(tt => [tt.Name, tt.Id]);
    sheet.getRange(2, 1, dataRows.length, 2).setValues(dataRows);
  }

  // Auto-fit columns
  sheet.autoResizeColumns(1, 2);
  
  console.log(`Wrote ${ticketTypes.length} ticket types to sheet.`);
}

/**
 * Entrypoint to fetch and populate the "Ticket Tags" sheet if it exists.
 * Can be run independently without executing the full sync.
 */
function populateTicketTagsReference() {
  console.log('Starting populateTicketTagsReference...');
  
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Ticket Tags');
  
  if (!sheet) {
    console.log('Ticket Tags sheet not found. Skipping population.');
    return;
  }
  
  validateApiConfig_();
  console.log('API config validation passed.');

  try {
    const tags = fetchAllTags_();
    console.log(`Fetched ${tags.length} tags.`);
    writeTagsToSheet_(sheet, tags);
    console.log('Tags written to "Ticket Tags" sheet.');
  } catch (error) {
    console.error(`Failed to populate tags: ${error.message}`);
    throw error;
  }
}

/**
 * Writes tags to the provided sheet with formatted headers and data.
 * @param {Sheet} sheet - The sheet to populate
 * @param {Array} tags - Array of tag objects
 */
function writeTagsToSheet_(sheet, tags) {
  // Clear existing data
  sheet.clear();
  
  const headerRow = ['Name', 'ID'];
  sheet.getRange(1, 1, 1, 2).setValues([headerRow]);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  sheet.getRange(1, 1, 1, 2).setBackground('#D3D3D3');

  if (tags.length > 0) {
    const dataRows = tags.map(tag => [tag.Name, tag.Id]);
    sheet.getRange(2, 1, dataRows.length, 2).setValues(dataRows);
  }

  sheet.autoResizeColumns(1, 2);
  console.log(`Wrote ${tags.length} tags to sheet.`);
}
