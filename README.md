# Marketplace Nexus Server

A Node.js server for integrating with multiple marketplace APIs (Walmart, Amazon, Home Depot, etc.) to retrieve seller listings and fetch product data. **Recently refactored** with clean service architecture for better maintainability and debugging.

## Features

### Marketplace Integrations
- **Walmart Marketplace API**: Fetch seller listings, details, and orders
- **Amazon SP-API**: Retrieve Amazon seller inventory
- **Order Management**: Complete order sync with profit tracking
- **TrajectData APIs**: Fetch real product data from multiple sources
  - BigBox API for Home Depot products
  - (Future) Rainforest API for Amazon products
  - (Future) BlueCart API for Walmart products

### Core Features
- **Service Architecture**: Clean separation of concerns with dedicated services
  - `AuditService` - Centralized event logging
  - `RepricingService` - Price calculations and marketplace updates
  - `ProductRefreshService` - Product refresh orchestration
  - `ProductSourcingService` - External API fetching
  - `WalmartOrderService` - Order sync and data transformation
- Secure credential management
- Multi-marketplace authentication
- Real-time product data fetching
- Automated product refresh and repricing
- Standardized response format across all marketplaces
- Service-to-service authentication for Edge Functions
- Ready for deployment to Render

## Prerequisites

- Node.js 18+
- API credentials for the marketplaces you want to integrate:
  - Walmart: Client ID and Client Secret from Walmart Seller Center
  - Amazon: SP-API credentials (Client ID, Client Secret, Refresh Token)
  - TrajectData: API keys for BigBox, Rainforest, or BlueCart APIs

## Setup

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/walmart-api-server.git
   cd walmart-api-server
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```

4. Fill in your environment variables in the `.env` file:
   ```
   PORT=8000
   NODE_ENV=development
   CORS_ORIGIN=http://localhost:3000
   
   # TrajectData API Keys (for product data fetching)
   BIGBOX_API_KEY=your_bigbox_api_key_here
   RAINFOREST_API_KEY=your_rainforest_api_key_here
   BLUECART_API_KEY=your_bluecart_api_key_here
   
   # Supabase (for service operations)
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   
   # Backend URL (for service-to-service calls)
   BACKEND_URL=https://your-app.onrender.com
   ```
   
   Note: Walmart and Amazon seller credentials are passed via request headers, not stored in environment variables.

5. Start the development server:
   ```
   npm run dev
   ```

## Environment Variables

### Required Variables
- `PORT`: The port on which the server will run (default: 8000)
- `NODE_ENV`: Environment (development/production)
- `CORS_ORIGIN`: The frontend URL for CORS configuration
- `SUPABASE_URL`: Your Supabase project URL (**Required for order sync**)
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (**Required for order sync**)

### Optional Variables
- `BIGBOX_API_KEY`: TrajectData BigBox API key (for Home Depot products)
- `RAINFOREST_API_KEY`: TrajectData Rainforest API key (for Amazon products)  
- `BLUECART_API_KEY`: TrajectData BlueCart API key (for Walmart products)
- `BACKEND_URL`: Backend URL for service-to-service calls
- `JWT_SECRET`: JWT secret for legacy authentication (fallback)

### Deployment Notes
- **Order Management**: Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for database operations
- **Authentication**: Uses Supabase JWT tokens for user authentication
- **Marketplace Credentials**: Stored securely in Supabase, not environment variables

## API Routes

### Walmart Marketplace
- `POST /api/walmart/auth`: Validate and store Walmart API credentials
- `GET /api/walmart/listings`: Get all listings from your Walmart seller account
- `GET /api/walmart/listing/:id`: Get a specific listing by ID
- `POST /api/walmart/update-price`: Update listing price on Walmart

### Amazon SP-API
- `POST /api/amazon/auth`: Authenticate with Amazon SP-API
- `GET /api/amazon/listings`: Get all listings from your Amazon seller account
- `GET /api/amazon/listing/:sku`: Get a specific listing by SKU

### Product Data Fetching (TrajectData)
- `POST /api/products/fetch`: Fetch real product data from any supported marketplace
- `POST /api/products/refresh`: Refresh single product (legacy endpoint)
- `GET /api/products/marketplaces`: Get list of supported marketplaces for product fetching

### **NEW: Product Refresh Services**
- `POST /api/products/refresh-user`: Refresh all products for a user (called by Edge Function)
- `POST /api/products/refresh-batch`: Refresh specific products by IDs
- `POST /api/products/refresh/:productId`: Refresh single product

### **NEW: Repricing Services**
- `POST /api/repricing/batch`: Batch repricing (called by Edge Function)
- `POST /api/repricing/product/:productId`: Reprice single product
- `POST /api/repricing/calculate`: Calculate minimum price for product
- `POST /api/repricing/update-marketplace-price`: Update price directly on marketplace

### **NEW: Order Management**
- `GET /api/orders/walmart`: Fetch Walmart orders with query parameters
  - **Query Parameters**: `createdStartDate`, `createdEndDate`, `limit`, `status`, `cursor`
  - **Response**: Paginated order list with metadata
- `GET /api/orders/walmart/:orderId`: Get specific Walmart order details
- `POST /api/orders/sync/walmart`: Manual order sync with listing matching
  - **Body**: `{ marketplaceId, dateRange: { startDate, endDate }, fullSync }`
  - **Process**: Fetches orders, matches SKUs to listings, calculates profits
- `GET /api/orders/sync-status/:marketplaceId`: Get order sync status
  - **Response**: `{ status, total_orders, last_full_sync, last_incremental_sync }`

### Authentication
- **JWT Token**: Standard user authentication via `Authorization: Bearer <token>`
- **Service Role**: Internal service calls via `X-Service-Role: true` + `X-User-Id: <userId>`

## Deployment to Render

1. Create a new Web Service on Render
2. Link to your GitHub repository
3. Configure the following:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add your environment variables
5. Click "Create Web Service"

## License

MIT
