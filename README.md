# Walmart API Server

A Node.js server for integrating with the Walmart Marketplace API to retrieve seller listings and perform other marketplace operations.

## Features

- Secure credential storage
- Authentication with Walmart Marketplace API
- Fetch all listings from a Walmart seller account
- Fetch individual listing details
- Ready for deployment to Render

## Prerequisites

- Node.js 18+
- A Walmart Seller account with API access
- Client ID and Client Secret from Walmart Seller Center

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
   ```

5. Start the development server:
   ```
   npm run dev
   ```

## Environment Variables

- `PORT`: The port on which the server will run
- `NODE_ENV`: Environment (development/production)
- `CORS_ORIGIN`: The frontend URL for CORS configuration

## API Routes

### Authentication
- `POST /api/walmart/auth`: Validate and store Walmart API credentials

### Listings
- `GET /api/walmart/listings`: Get all listings
- `GET /api/walmart/listing/:id`: Get a specific listing by ID

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
