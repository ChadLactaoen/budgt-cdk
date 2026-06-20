import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const TABLE_NAME = process.env.TABLE_NAME || 'Budgt';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    // Extract email from Cognito claims
    const claims = event.requestContext.authorizer?.claims;
    const email = claims?.email || 'unknown';

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: `Hello, ${email}! Welcome to Budgt.`,
        timestamp: new Date().toISOString(),
        tableName: TABLE_NAME,
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
