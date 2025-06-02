# Amazon Reports API Implementation

## Overview

This update replaces the problematic Amazon Listings Items API approach with the correct Reports API method for fetching all seller listings.

## What Changed

### Backend (`amazonService.js`)

1. **Added Reports API Methods**:
   - `requestListingsReport()` - Request a listings report
   - `getReportStatus()` - Check report processing status
   - `getReportDownloadUrl()` - Get download URL for completed report
   - `downloadAndParseReport()` - Download and parse tab-delimited report
   - `parseTabDelimitedReport()` - Parse the report data
   - `getListingsViaReports()` - Main method using Reports API

2. **Updated `getListings()` Method**:
   - Now uses Reports API by default
   - Falls back to legacy method if Reports API fails
   - Maintains backward compatibility

3. **Supported Report Types**:
   - `GET_FLAT_FILE_OPEN_LISTINGS_DATA` - Active listings (default)
   - `GET_MERCHANT_LISTINGS_ALL_DATA` - All listings including inactive
   - `GET_MERCHANT_LISTINGS_DATA` - Active listings only
   - `GET_MERCHANT_LISTINGS_INACTIVE_DATA` - Inactive listings only

### Backend Routes (`amazon.js`)

1. **New Endpoints**:
   - `POST /api/amazon/request-listings-report` - Start report generation
   - `GET /api/amazon/report-status/:reportId` - Check report status
   - `GET /api/amazon/download-report/:reportDocumentId` - Download parsed listings

2. **Updated Endpoints**:
   - `GET /api/amazon/listings` - Now uses Reports API internally
   - `POST /api/amazon/sync-listings` - Updated to use Reports API

### Frontend (`amazonApiService.ts`)

1. **New Methods**:
   - `requestListingsReport()` - Request report
   - `getReportStatus()` - Check status
   - `downloadReport()` - Download parsed data
   - `getListingsWithReports()` - Convenience method with progress updates

2. **Maintained Compatibility**:
   - Existing `getListings()` calls still work
   - Response format unchanged

### Frontend Hooks (`useAmazonApi.ts`)

1. **New Hooks**:
   - `useAmazonListingsWithReports()` - Full report flow with progress
   - `useAmazonReportFlow()` - Manual control over report process

2. **Existing Hook Updated**:
   - `useAmazonListings()` - Now uses Reports API internally

## How It Works

1. **Request Phase**: Client requests a report from Amazon
2. **Processing Phase**: Poll every 10 seconds until report is ready (typically 30s-15min)
3. **Download Phase**: Download and parse the tab-delimited report
4. **Transform Phase**: Convert to existing listing format

## Benefits

- ✅ Gets ALL listings in one request (no pagination needed)
- ✅ Much faster for large inventories
- ✅ Includes all essential data (SKU, ASIN, price, quantity, etc.)
- ✅ Proper Amazon-recommended approach
- ✅ Backward compatible with existing code

## Report Processing Times

- Small inventory (< 1,000 items): 30 seconds - 2 minutes
- Medium inventory (1,000 - 10,000 items): 2 - 5 minutes
- Large inventory (> 10,000 items): 5 - 15 minutes

## Usage Examples

### Using the Updated Hook (Recommended)
```javascript
// This automatically uses Reports API now
const { data: listings } = useAmazonListings(connection, options, enabled);
```

### Using the New Reports Hook
```javascript
// For progress updates
const { data, isLoading } = useAmazonListingsWithReports(connection, {
  reportType: 'GET_FLAT_FILE_OPEN_LISTINGS_DATA',
  enabled: true
});
```

### Direct API Usage
```javascript
// Full control over the process
const listings = await amazonApiService.getListingsWithReports(
  connection,
  'GET_FLAT_FILE_OPEN_LISTINGS_DATA',
  (status) => console.log(status)
);
```

## Error Handling

The implementation includes:
- Automatic fallback to legacy API if Reports API fails
- Timeout protection (15 minutes max)
- Proper error messages for failed reports
- Retry logic for transient failures

## No Breaking Changes

All existing code continues to work without modification. The Reports API is used transparently behind the scenes.