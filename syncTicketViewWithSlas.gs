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
   * Saved ticket view identifier (GUID) that the sync should evaluate.
   * The script filters tickets by this view ID via the view facet in POST /api/v1.0/tickets.
   */
  viewId: '',
  /**
   * Row + column (E2) where the data table should begin inside the Devices/Hardware sheet.
   */
  startRow: 2,
  startColumn: 5,
  sheetName: 'Devices/Hardware',
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
  debugLimit: 100
};

/**
 * Entrypoint invoked from the Apps Script editor or via time-based trigger.
 * Gathers all tickets filtered by view, fetches SLA data in bulk, and writes rows.
 */
function syncIncidentIqTickets() {
  debugLog_('Starting syncIncidentIqTickets...');
  validateConfig_();
  debugLog_('Config validation passed.');

  const sheet = SpreadsheetApp.getActive().getSheetByName(INCIDENT_IQ_CONFIG.sheetName);
  if (!sheet) {
    throw new Error(`Sheet "${INCIDENT_IQ_CONFIG.sheetName}" was not found in the active spreadsheet.`);
  }
  debugLog_(`Found sheet: ${INCIDENT_IQ_CONFIG.sheetName}`);

  // Step 1: Gather all tickets from the view using view facet filter
  debugLog_(`Step 1: Fetching tickets from view ${INCIDENT_IQ_CONFIG.viewId}...`);
  if (INCIDENT_IQ_CONFIG.debugMode) {
    debugLog_(`  DEBUG MODE: Limiting results to ${INCIDENT_IQ_CONFIG.debugLimit} records.`);
  }
  const allTickets = [];
  let pageIndex = 0;
  while (true) {
    debugLog_(`  Fetching ticket page ${pageIndex}...`);
    const ticketPage = searchTicketsByView_(INCIDENT_IQ_CONFIG.viewId, pageIndex, INCIDENT_IQ_CONFIG.pageSize);
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
  clearDestination_(sheet);
  if (rows.length) {
    sheet
      .getRange(INCIDENT_IQ_CONFIG.startRow, INCIDENT_IQ_CONFIG.startColumn, rows.length, 7)
      .setValues(rows);
    debugLog_(`Successfully wrote ${rows.length} rows to spreadsheet.`);
  }
  debugLog_('syncIncidentIqTickets completed successfully.');
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
 * Ensures critical config tokens are populated prior to running the sync.
 */
function validateConfig_() {
  debugLog_('Validating configuration...');
  const missing = Object.entries({
    subdomain: INCIDENT_IQ_CONFIG.subdomain,
    siteId: INCIDENT_IQ_CONFIG.siteId,
    apiToken: INCIDENT_IQ_CONFIG.apiToken,
    viewId: INCIDENT_IQ_CONFIG.viewId
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    const errorMsg = `Configure INCIDENT_IQ_CONFIG (${missing.join(', ')}) before running the sync.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  debugLog_('All configuration values present.');
}

/**
 * Issues POST /api/v1.0/tickets with a view facet filter and pagination controls.
 */
function searchTicketsByView_(viewId, pageIndex, pageSize) {
  const query = buildQueryString_({ $p: pageIndex, $s: pageSize, $o: 'TicketClosedDate ASC' });
  const requestBody = {
    Filters: [
      {
        Facet: 'view',
        Id: viewId,
        Selected: true
      }
    ]
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
      if (slaItem?.TicketId && !slaLookup[slaItem.TicketId]) {
        slaLookup[slaItem.TicketId] = slaItem;
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
 * Returns formatted string like "Sla: < 2 Days / Actual: 6.2 Days"
 */
function deriveResolutionTime_(ticket, slaDetails) {
  if (!slaDetails) {
    return '';
  }

  // Debug: log the structure
  debugLog_(`Debug - slaDetails keys: ${Object.keys(slaDetails || {}).join(', ')}`);

  // Find Resolution Time metric in Metrics array for SLA target
  let slaValue = '';
  let metrics = slaDetails?.Metrics;
  
  // If Metrics is not found directly, check if it's nested under Sla
  if (!metrics && slaDetails?.Sla?.Metrics) {
    metrics = slaDetails.Sla.Metrics;
  }

  if (Array.isArray(metrics)) {
    debugLog_(`Debug - Found ${metrics.length} metrics`);
    const resolutionMetric = metrics.find(
      metric => metric?.Name && /resolution\s*time/i.test(metric.Name)
    );
    if (resolutionMetric) {
      debugLog_(`Debug - Resolution metric found: Value=${resolutionMetric.Value}, Unit=${resolutionMetric.Unit}, ValueInMinutes=${resolutionMetric.ValueInMinutes}`);
      // Try to get Value and Unit first, then fall back to ValueInMinutes
      if (resolutionMetric.Value && resolutionMetric.Unit) {
        slaValue = `${resolutionMetric.Value} ${resolutionMetric.Unit}`;
      } else if (resolutionMetric.ValueInMinutes) {
        const days = (resolutionMetric.ValueInMinutes / 1440).toFixed(1);
        slaValue = `${days} Days`;
      }
    } else {
      debugLog_(`Debug - No resolution metric found. Metrics: ${JSON.stringify(metrics.map(m => m.Name))}`);
    }
  } else {
    debugLog_(`Debug - Metrics is not an array or not found. Type: ${typeof metrics}`);
  }

  // Find Resolution Time in SlaTimes array for actual time
  let actualValue = '';
  const slaTimes = slaDetails?.SlaTimes;
  if (Array.isArray(slaTimes)) {
    const resolutionTime = slaTimes.find(
      time => time?.Name && /resolution\s*time/i.test(time.Name)
    );
    if (resolutionTime && resolutionTime.LogMinutes !== undefined && resolutionTime.LogMinutes !== null) {
      const days = (resolutionTime.LogMinutes / 1440).toFixed(1); // 1440 minutes in a day
      actualValue = `${days} Days`;
      debugLog_(`Debug - Resolution time found: LogMinutes=${resolutionTime.LogMinutes}, Days=${days}`);
    }
  }

  // Format the output
  if (slaValue && actualValue) {
    return `Sla: < ${slaValue} / Actual: ${actualValue}`;
  } else if (slaValue) {
    return `Sla: < ${slaValue}`;
  } else if (actualValue) {
    return `Actual: ${actualValue}`;
  }

  return '';
}

function formatDateForSheet_(isoDate) {
  const date = new Date(isoDate);
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(date, tz, 'yyyy-MM-dd HH:mm');
}

function clearDestination_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow >= INCIDENT_IQ_CONFIG.startRow) {
    sheet
      .getRange(
        INCIDENT_IQ_CONFIG.startRow,
        INCIDENT_IQ_CONFIG.startColumn,
        Math.max(lastRow - INCIDENT_IQ_CONFIG.startRow + 1, 1),
        7
      )
      .clearContent();
  }
}

/**
 * Determines whether more pages should be requested using Paging metadata.
 */
function hasMorePages_(response, pageSize) {
  const paging = response?.Paging || response?.paging;
  if (paging && typeof paging.PageCount === 'number' && typeof paging.PageIndex === 'number') {
    return paging.PageIndex < paging.PageCount - 1;
  }

  const items = Array.isArray(response?.Items) ? response.Items : [];
  return Boolean(pageSize && items.length === pageSize);
}

/**
 * Base Incident IQ request helper that injects auth headers.
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
