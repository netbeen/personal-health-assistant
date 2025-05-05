import dotenv from 'dotenv';
import logger from './logger.js'; // 导入日志记录器
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import {
  HumanMessage,
  BaseMessage,
} from '@langchain/core/messages';
import { StateGraph, START, END, CompiledStateGraph } from '@langchain/langgraph';
import { Runnable } from '@langchain/core/runnables';

interface AgentState {
  messages: BaseMessage[];
}

function initializeEnvironmentAndLLM(): ChatOpenAI {
  dotenv.config({ path: 'local.env' });

  const endpointId = process.env.ENDPOINT_ID;
  const endpointApiKey = process.env.ENDPOINT_API_KEY;
  const arkBaseUrl = process.env.ARK_BASE_URL;

  if (!endpointId || !endpointApiKey || !arkBaseUrl) {
    logger.error('[initializeEnvironmentAndLLM] 缺少必要的环境变量 (ENDPOINT_ID, ENDPOINT_API_KEY, ARK_BASE_URL)。');
    process.exit(1);
  }

  const llm = new ChatOpenAI({
    apiKey: endpointApiKey,
    model: endpointId,
    configuration: {
      baseURL: arkBaseUrl,
    },
    temperature: 0,
  });
  logger.info('[initializeEnvironmentAndLLM] ChatOpenAI LLM Initialized.');
  return llm;
}

/**
 * 创建健康助手的 Agent Runnable
 * Agent Runnable 是 LangChain 中的一个核心概念，代表一个可执行的代理逻辑单元
 * @param llm - ChatOpenAI 实例
 * @returns Agent Runnable 实例
 */
async function createHealthAgentRunnable(llm: ChatOpenAI): Promise<Runnable> {
  const tools: any[] = [];
  logger.info(`[createHealthAgentRunnable] tools.length=${tools.length}`);

  const healthAgentRunnable = await createReactAgent({
    llm,
    tools,
  });
  logger.info(`[createHealthAgentRunnable] healthAgentRunnable Initialized.`);
  return healthAgentRunnable;
}

/**
 * 定义 LangGraph 中的健康助手节点函数
 * 这个函数会被 LangGraph 调用，执行健康助手的核心逻辑
 * @param state - 当前的 AgentState
 * @param healthAgentRunnable - Health Agent Runnable 实例
 * @returns 更新后的状态，包含 Agent 的响应消息
 */
async function callHealthAgentNode(state: AgentState, healthAgentRunnable: Runnable): Promise<Partial<AgentState>> {
  logger.debug('[HealthAgent] 调用健康助手节点...');
  const response = await healthAgentRunnable.invoke(state);
  logger.debug('[HealthAgent] 收到响应:', response);
  return { messages: response.messages };
}

/**
 * 定义 LangGraph 中的 Supervisor 节点的路由逻辑
 * Supervisor 决定下一个要执行的节点
 * @param state - 当前的 AgentState
 * @returns 下一个节点的名称 ('health_agent') 或结束标志 (END)
 */
function routeLogic(state: AgentState): string | typeof END {
  logger.debug('[Supervisor] Deciding next step...');
  const lastMessage = state.messages[state.messages.length - 1];

  if (lastMessage instanceof HumanMessage) {
    logger.info('[Supervisor] Route to Health Agent。');
    return 'health_agent';
  } else {
    logger.info('[Supervisor] Route to END。');
    return END;
  }
}

/**
 * 定义 LangGraph 中的 Supervisor 节点函数
 * 这个节点本身不执行复杂操作，主要用于路由决策
 * @param state - 当前的 AgentState
 * @returns 空对象，表示不直接修改状态 (路由逻辑在 addConditionalEdges 中处理)
 */
function supervisorNode(state: AgentState): Partial<AgentState> {
  logger.debug('[Supervisor] 通过 Supervisor 节点。');
  return {};
}

/**
 * 构建 LangGraph 工作流
 * @param healthAgentRunnable - Health Agent Runnable 实例
 * @returns 编译后的 LangGraph 应用
 */
function buildWorkflow(healthAgentRunnable: Runnable): CompiledStateGraph<AgentState, Partial<AgentState>> {
  // Reference: https://langchain-ai.github.io/langgraphjs/reference/classes/langgraph.StateGraph.html
  const workflow = new StateGraph<AgentState>({
    channels: {
      messages: {
        value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => [],
      },
    },
  });
  logger.info('[buildWorkflow] StateGraph Initialized.');

  workflow.addNode('health_agent', (state) => callHealthAgentNode(state, healthAgentRunnable));
  workflow.addNode('supervisor', supervisorNode);
  logger.info('[buildWorkflow] health_agent, supervisor added into StateGraph.');

  workflow.addEdge(START, 'supervisor');
  workflow.addConditionalEdges(
    'supervisor',
    routeLogic,
    {
      'health_agent': 'health_agent',
      [END]: END
    }
  );
  workflow.addEdge('health_agent', 'supervisor');

  const app = workflow.compile();
  logger.info('[buildWorkflow] LangGraph workflow compiled.');
  return app;
}

/**
 * 运行 LangGraph 应用并处理流式输出
 * @param app - 编译后的 LangGraph 应用
 * @param initialInput - 初始输入消息
 */
async function runWorkflow(app: CompiledStateGraph<AgentState, Partial<AgentState>>, initialInput: AgentState) {
  const stream = await app.stream(
    initialInput,
    {
      streamMode: 'values',
    }
  );

  for await (const value of stream) {
    const lastMessage = value.messages[value.messages.length - 1];
    if (lastMessage) {
      logger.info(`[runWorkflow] 节点: ${lastMessage.__type}, content: ${lastMessage.content}`);
      if (lastMessage.response_metadata) {
        logger.info('[runWorkflow] response_metadata:', lastMessage.response_metadata);
      }
    }
  }
}

async function main() {
  try {
    const llm = initializeEnvironmentAndLLM();
    const healthAgentRunnable = await createHealthAgentRunnable(llm);
    const app = buildWorkflow(healthAgentRunnable);
    const initialInput: AgentState = {
      messages: [new HumanMessage({ content: '你好啊' })],
    };
    await runWorkflow(app, initialInput);
  } catch (error) {
    logger.error('主函数发生未处理错误:', error);
    process.exit(1);
  }
}

main();
