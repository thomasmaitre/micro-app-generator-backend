require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Origin'],
    credentials: false,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

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

app.get('/', (req, res) => {
    res.json({ 
        status: 'Server is running',
        endpoints: ['/generate-card'],
        version: '1.0.0'
    });
});

// Request tracking
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

        console.log('Making request with description:', description);
        const cardJson = await makeOpenAIRequest(description);
        console.log('Successfully generated card');
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

        res.status(500).json({ 
            error: error.message || 'An error occurred while generating the card',
            details: error.stack
        });
    } finally {
        activeRequests--;
        console.log(`Request completed. Active requests: ${activeRequests}`);
    }
});

async function makeOpenAIRequest(description) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OpenAI API key is not configured');
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant that generates Adaptive Cards JSON. Create visually appealing cards that follow best practices for layout and design."
                    },
                    {
                        role: "user",
                        content: `Create an Adaptive Card JSON for: ${description}`
                    }
                ],
                temperature: 0.7
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const responseData = await response.json();
            console.error('OpenAI error response:', responseData);
            
            const error = new Error(responseData.error?.message || 'OpenAI API request failed');
            if (response.status === 429) {
                error.isRateLimit = true;
                error.retryAfter = 3600;
            }
            throw error;
        }

        const data = await response.json();
        console.log('OpenAI response:', data);
        
        if (!data.choices?.[0]?.message?.content) {
            throw new Error('Invalid response from OpenAI');
        }

        const content = data.choices[0].message.content;
        console.log('Parsing content:', content);
        
        const cardJson = JSON.parse(content);
        if (!cardJson.type || cardJson.type !== 'AdaptiveCard') {
            throw new Error('Invalid Adaptive Card format');
        }

        return cardJson;
    } catch (error) {
        console.error('Error in makeOpenAIRequest:', error);
        if (error.name === 'AbortError') {
            throw new Error('Request timed out');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Environment check:', {
        nodeEnv: process.env.NODE_ENV,
        hasOpenAIKey: !!process.env.OPENAI_API_KEY
    });
});
