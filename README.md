# Micro App Generator Backend

Backend service for the Micro App Generator application. This service handles the OpenAI API integration for generating Adaptive Cards.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
Create a `.env` file with:
```
OPENAI_API_KEY=your_api_key_here
```

3. Run the server:
```bash
node server.js
```

## API Endpoints

- `GET /` - Health check endpoint
- `POST /generate-card` - Generate an Adaptive Card from a description

## Deployment

This service is designed to be deployed on Railway.app.
