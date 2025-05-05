import dotenv from 'dotenv';
import logger from './logger.js'; // Import the logger
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, SystemMessage, ToolMessage, AIMessage, BaseMessage } from '@langchain/core/messages';



// Define the main async function
async function main() {
  dotenv.config({ path: 'local.env' });

  // Example of logging an object
  const user = { id: 1, name: 'Test User' };
  logger.info('User object:', user);

  // Example of logging with string interpolation
  const variable = process.env.MY_VARIABLE;
  logger.info(`My variable value is: ${variable}`);

  const endpointId = process.env.ENDPOINT_ID;
  const endpointApiKey = process.env.ENDPOINT_API_KEY;
  const arkBaseUrl = process.env.ARK_BASE_URL;

  const llm = new ChatOpenAI({
    apiKey: endpointApiKey,
    model: endpointId,
    configuration: {
      baseURL: arkBaseUrl
    },
    temperature: 0,
  });

  const agent = await createReactAgent({
    llm,
    tools: [],
  });
  logger.debug('Agent init successfully.')

  const stream = await agent.stream({messages: [new HumanMessage({content:"你好啊"})]}, { streamMode: "updates" });

  for await (const {agent, tools} of stream) {
    const rawResponseMessages: BaseMessage[] = []
      if(agent){
        logger.debug(`[chatHandler] Receive ${agent.messages.length} AI Messages`);
        rawResponseMessages.push(...agent.messages);
      }else if(tools){
        logger.debug(`[chatHandler] Receive ${tools.messages.length} Tool Messages`);
        rawResponseMessages.push(...tools.messages);
      }

      for(let {response_metadata, content, id} of rawResponseMessages){
        logger.info(`id: ${id}, content: ${content}`)
        logger.info('response_metadata: ',response_metadata)
      }
  }
}

// Call the main function
main().catch(error => {
  logger.error('Unhandled error in main function:', error);
  process.exit(1); // Exit with error code
});
