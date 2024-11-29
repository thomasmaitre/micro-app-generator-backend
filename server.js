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

// Add a root endpoint for testing
app.get('/', (req, res) => {
    res.json({ status: 'Server is running', endpoints: ['/generate-card'] });
});

async function makeOpenAIRequest(description, retryCount = 0) {
    try {
        console.log(`Making OpenAI request for description: ${description} (attempt ${retryCount + 1})`);
        
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
                        content: `Create an Adaptive Card JSON for: ${description}. Make it visually appealing and functional. Add structure input fields, buttons, and other interactive elements to make it user-friendly. If the card is a list, make the elements visually distinct and easy to navigate.`
                    }
                ],
                temperature: 0.7
            })
        });

        console.log('OpenAI response status:', response.status);
        const responseData = await response.json();
        console.log('OpenAI response:', responseData);

        if (!response.ok) {
            if (responseData.error?.type === 'resource_exhausted' && retryCount < MAX_RETRIES) {
                console.log('Rate limit hit, retrying after delay...');
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                return makeOpenAIRequest(description, retryCount + 1);
            }
            throw new Error(responseData.error?.message || 'API request failed');
        }

        const cardJson = JSON.parse(responseData.choices[0].message.content);
        return cardJson;
    } catch (error) {
        console.error('Error in makeOpenAIRequest:', error);
        if (error.message.includes('rate limit') && retryCount < MAX_RETRIES) {
            console.log('Rate limit error, retrying after delay...');
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return makeOpenAIRequest(description, retryCount + 1);
        }
        throw error;
    }
}

app.post('/generate-card', async (req, res) => {
    console.log('Received request:', req.body);
    
    try {
        const { description } = req.body;
        
        if (!description) {
            return res.status(400).json({ 
                error: 'Description is required',
                details: 'Please provide a description for the card generation'
            });
        }

        const cardJson = await makeOpenAIRequest(description);
        console.log('Successfully generated card');
        res.json(cardJson);
    } catch (error) {
        console.error('Error in /generate-card:', error);
        const statusCode = error.message.includes('rate limit') ? 429 : 500;
        const userMessage = error.message.includes('rate limit') 
            ? 'The service is temporarily busy. Please try again in a few moments.'
            : 'An error occurred while generating the card. Please try again.';
        
        res.status(statusCode).json({ 
            error: userMessage,
            details: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
