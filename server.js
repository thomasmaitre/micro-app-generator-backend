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

async function makeOpenAIRequest(description, retryCount = 0) {
    try {
        if (!process.env.OPENAI_API_KEY) {
            console.error('OpenAI API key missing');
            throw new Error('OpenAI API key is not configured');
        }

        console.log(`Making OpenAI request for description: ${description} (attempt ${retryCount + 1})`);
        console.log('API Key exists:', !!process.env.OPENAI_API_KEY);
        
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

        console.log('Request body:', JSON.stringify(requestBody, null, 2));
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify(requestBody)
        });

        console.log('OpenAI response status:', response.status);
        const responseData = await response.json();
        console.log('OpenAI response:', JSON.stringify(responseData, null, 2));

        if (!response.ok) {
            console.error('OpenAI error response:', responseData);
            if (responseData.error?.type === 'resource_exhausted' || responseData.error?.message?.includes('rate limit')) {
                const error = new Error('Rate limit reached');
                error.isRateLimit = true;
                error.retryAfter = 3600; // 1 hour in seconds
                throw error;
            }
            throw new Error(responseData.error?.message || 'API request failed');
        }

        if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
            console.error('Invalid OpenAI response format:', responseData);
            throw new Error('Invalid response format from OpenAI');
        }

        try {
            const content = responseData.choices[0].message.content;
            console.log('Attempting to parse content:', content);
            const cardJson = JSON.parse(content);
            
            if (!cardJson.type || cardJson.type !== 'AdaptiveCard') {
                console.error('Invalid card format:', cardJson);
                throw new Error('Response is not a valid Adaptive Card');
            }
            
            return cardJson;
        } catch (parseError) {
            console.error('Error parsing OpenAI response:', parseError);
            console.error('Raw content:', responseData.choices[0].message.content);
            throw new Error('Failed to parse OpenAI response as JSON');
        }
    } catch (error) {
        console.error('Error in makeOpenAIRequest:', error.message);
        console.error('Error stack:', error.stack);
        throw error;
    }
}

app.post('/generate-card', async (req, res) => {
    console.log('Received request:', req.body);
    console.log('Headers:', req.headers);
    
    try {
        const { description } = req.body;
        
        if (!description) {
            console.log('Missing description in request');
            return res.status(400).json({ 
                error: 'Description is required',
                details: 'Please provide a description for the card generation'
            });
        }

        console.log('Starting card generation for description:', description);
        const cardJson = await makeOpenAIRequest(description);
        console.log('Successfully generated card:', JSON.stringify(cardJson, null, 2));
        res.json(cardJson);
    } catch (error) {
        console.error('Error in /generate-card:', {
            message: error.message,
            stack: error.stack,
            isRateLimit: error.isRateLimit,
            retryAfter: error.retryAfter
        });
        
        if (error.isRateLimit) {
            return res.status(429).json({
                error: 'Rate limit exceeded',
                details: 'The AI service is currently at capacity. Please try again in about an hour.',
                retryAfter: error.retryAfter || 3600
            });
        }
        
        const statusCode = error.message.includes('API key') ? 500 : 500;
        const userMessage = error.message.includes('API key') 
            ? 'Server configuration error. Please contact support.'
            : 'An error occurred while generating the card. Please try again.';
        
        res.status(statusCode).json({ 
            error: userMessage,
            details: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Environment check:', {
        nodeEnv: process.env.NODE_ENV,
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        openAIKeyLength: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0
    });
});
