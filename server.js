require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// Configure CORS to accept requests from all origins during development
const corsOptions = {
    origin: '*', // Allow all origins
    methods: ['GET', 'POST', 'OPTIONS'], // Allow these HTTP methods
    allowedHeaders: ['Content-Type', 'Accept', 'Origin'], // Allow these headers
    credentials: false, // Don't allow credentials
    optionsSuccessStatus: 200 // Return 200 for OPTIONS requests
};

app.use(cors(corsOptions));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error('Global error handler:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        body: req.body
    });
    
    res.status(500).json({
        error: 'Internal server error',
        details: err.message
    });
});

// Add a root endpoint for testing
app.get('/', (req, res) => {
    res.json({ 
        status: 'Server is running',
        endpoints: ['/generate-card'],
        version: '1.0.0'
    });
});

// Add connection pooling agent
const Agent = require('agentkeepalive');

// Create agent factory function
function createAgent() {
    return new Agent({
        maxSockets: 100,
        maxFreeSockets: 10,
        timeout: 60000,
        freeSocketTimeout: 30000,
    });
}

let keepaliveAgent = createAgent();

// Recreate agent periodically instead of just destroying it
setInterval(() => {
    const oldAgent = keepaliveAgent;
    keepaliveAgent = createAgent();
    // Destroy old agent after a grace period to allow pending requests to complete
    setTimeout(() => oldAgent.destroy(), 5000);
}, 60000);

// Add request tracking
let activeRequests = 0;
const maxConcurrentRequests = 1;

app.post('/generate-card', async (req, res) => {
    if (activeRequests >= maxConcurrentRequests) {
        return res.status(429).json({
            error: 'Server busy',
            details: 'Too many concurrent requests. Please try again in a few seconds.'
        });
    }

    activeRequests++;
    console.log(`Active requests: ${activeRequests}`);

    try {
        const { description } = req.body;
        if (!description) {
            throw new Error('Description is required');
        }

        const cardJson = await makeOpenAIRequest(description);
        res.json(cardJson);
    } catch (error) {
        console.error('Error in /generate-card:', error);
        
        if (error.isRateLimit) {
            res.status(429).json({
                error: 'Rate limit exceeded',
                details: 'The AI service is currently at capacity. Please try again in about an hour.',
                retryAfter: error.retryAfter || 3600
            });
            return;
        }

        const statusCode = error.message.includes('timeout') ? 504 : 500;
        const userMessage = error.message.includes('timeout')
            ? 'Request timed out. Please try again.'
            : error.message || 'An error occurred while generating the card. Please try again.';
        
        res.status(statusCode).json({ 
            error: userMessage,
            details: error.message 
        });
    } finally {
        activeRequests--;
        console.log(`Request completed. Active requests: ${activeRequests}`);
    }
});

async function makeOpenAIRequest(description, retryCount = 0) {
    let controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        if (!process.env.OPENAI_API_KEY) {
            console.error('OpenAI API key missing');
            throw new Error('OpenAI API key is not configured');
        }

        console.log(`Making OpenAI request for description: ${description} (attempt ${retryCount + 1})`);
        
        const requestBody = {
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that generates Adaptive Cards JSON. Create visually appealing cards that follow best practices for layout and design."
                },
                {
                    role: "user",
                    content: `Create an Adaptive Card JSON for: ${description}. Make it visually appealing and functional. Add structure input fields, buttons, and other interactive elements to make it user-friendly. If the card is a list, make the elements visually distinct and easy to navigate.`
                }
            ],
            temperature: 0.7
        };

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Connection': 'close'
            },
            body: JSON.stringify(requestBody),
            agent: keepaliveAgent,
            signal: controller.signal,
            compress: true
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const error = new Error('OpenAI API request failed');
            error.status = response.status;
            error.statusText = response.statusText;
            
            if (response.status === 429) {
                error.isRateLimit = true;
                error.retryAfter = 3600;
            }
            
            throw error;
        }

        const data = await response.json();
        
        if (!data.choices?.[0]?.message?.content) {
            throw new Error('Invalid response from OpenAI');
        }

        const content = data.choices[0].message.content;
        const cardJson = JSON.parse(content);

        if (!cardJson.type || cardJson.type !== 'AdaptiveCard') {
            throw new Error('Invalid Adaptive Card format');
        }

        return cardJson;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Request timed out');
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

process.on('SIGTERM', () => {
    keepaliveAgent.destroy();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Environment check:', {
        nodeEnv: process.env.NODE_ENV,
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        openAIKeyLength: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0
    });
});
