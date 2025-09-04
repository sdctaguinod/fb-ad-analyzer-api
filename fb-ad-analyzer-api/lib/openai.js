import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error('Missing required OpenAI API key environment variable');
}

export const openai = new OpenAI({
  apiKey: apiKey,
});

export async function testOpenAIConnection() {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "user",
          content: "Hello, this is a connection test. Please respond with 'Connection successful'."
        }
      ],
      model: "gpt-3.5-turbo",
      max_tokens: 10
    });

    const response = completion.choices[0]?.message?.content;
    
    return {
      status: 'connected',
      message: 'OpenAI connection successful',
      response: response
    };
  } catch (error) {
    return {
      status: 'error',
      message: `OpenAI connection failed: ${error.message}`
    };
  }
}