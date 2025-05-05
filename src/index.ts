import dotenv from 'dotenv';
import logger from './logger.js'; // 导入日志记录器
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import {
  HumanMessage,
  BaseMessage,
} from '@langchain/core/messages';
import { StateGraph, END, CompiledStateGraph } from '@langchain/langgraph';
import { Runnable } from '@langchain/core/runnables';

// 定义 LangGraph 状态的接口
// 这个状态会在图的节点之间传递，包含了对话历史
interface AgentState {
  messages: BaseMessage[];
}

/**
 * 初始化环境和语言模型 (LLM)
 * @returns ChatOpenAI 实例
 */
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
  // 调用 Agent Runnable 处理当前状态中的消息
  const response = await healthAgentRunnable.invoke(state);
  // Agent Runnable 的响应包含了最终的消息列表
  logger.debug('[HealthAgent] 收到响应:', response);
  // 返回需要更新的状态部分，这里是更新后的消息列表
  return { messages: response.messages };
}

/**
 * 定义 LangGraph 中的 Supervisor 节点的路由逻辑
 * Supervisor 决定下一个要执行的节点
 * @param state - 当前的 AgentState
 * @returns 下一个节点的名称 ('health_agent') 或结束标志 (END)
 */
function routeLogic(state: AgentState): string | typeof END {
  logger.debug('[Supervisor] 决定下一步...');
  // 获取状态中的最后一条消息
  const lastMessage = state.messages[state.messages.length - 1];

  // 如果最后一条消息是用户输入 (HumanMessage)，则路由到健康助手节点
  if (lastMessage instanceof HumanMessage) {
    logger.info('[Supervisor] 路由到 Health Agent。');
    return 'health_agent';
  } else {
    // 否则，结束流程
    logger.info('[Supervisor] 路由到 END。');
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
  // 这个节点仅作为分支点，实际的路由逻辑在 addConditionalEdges 中定义
  return {};
}

/**
 * 构建 LangGraph 工作流
 * @param healthAgentRunnable - Health Agent Runnable 实例
 * @returns 编译后的 LangGraph 应用
 */
function buildWorkflow(healthAgentRunnable: Runnable): CompiledStateGraph<AgentState, Partial<AgentState>> {
  // 创建一个新的 StateGraph 实例
  // channels 定义了状态如何在图中流动和更新
  const workflow = new StateGraph<AgentState>({
    channels: {
      // 'messages' channel 用于存储对话消息
      messages: {
        // value 函数定义了如何合并新旧消息 (简单拼接)
        value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        // default 函数定义了 channel 的初始值 (空数组)
        default: () => [],
      },
    },
  });
  logger.info('StateGraph 实例已创建。');

  workflow.addNode('health_agent', (state) => callHealthAgentNode(state, healthAgentRunnable));
  workflow.addNode('supervisor', supervisorNode);
  logger.info('[buildWorkflow] health_agent, supervisor added into StateGraph.');

  // 定义图中的边 (连接关系和路由逻辑)
  // 添加从 'supervisor' 出发的条件边
  workflow.addConditionalEdges(
    'supervisor', // 起始节点
    routeLogic, // 用于决定下一个节点的路由函数
    {
      'health_agent': 'health_agent',
      [END]: END
    }
  );
  logger.info('从 Supervisor 出发的条件边已定义。');

  // 添加从 'health_agent' 到 'supervisor' 的普通边
  // 这意味着健康助手执行完毕后，流程回到 Supervisor 进行下一步决策
  workflow.addEdge('health_agent', 'supervisor');
  logger.info('从 Health Agent 到 Supervisor 的边已定义。');

  // 设置图的入口点为 'supervisor'
  workflow.setEntryPoint('supervisor');
  logger.info('图的入口点已设置为 Supervisor。');

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
  logger.info('--- 开始流式执行 Graph ---');
  // 使用 stream 方法执行图，传入初始输入
  const stream = await app.stream(
    initialInput,
    {
      // streamMode: 'values' 表示我们希望接收每次状态更新的完整值
      streamMode: 'values',
    }
  );

  // 异步迭代处理流式输出
  for await (const value of stream) {
    // 每个 value 代表图执行过程中某个时间点的完整状态
    const lastMessage = value.messages[value.messages.length - 1];
    if (lastMessage) {
      // 记录最后一条消息的类型和内容
      logger.info(`节点: ${lastMessage.__type}, 内容: ${lastMessage.content}`);
      // 如果有元数据，也一并记录
      if (lastMessage.response_metadata) {
        logger.info('元数据:', lastMessage.response_metadata);
      }
    }
  }
  logger.info('--- 流式执行 Graph 结束 ---');
}

async function main() {
  try {
    const llm = initializeEnvironmentAndLLM();
    const healthAgentRunnable = await createHealthAgentRunnable(llm);

    // 3. 构建 LangGraph 工作流
    const app = buildWorkflow(healthAgentRunnable);

    // 4. 定义初始输入
    const initialInput: AgentState = {
      messages: [new HumanMessage({ content: '你好啊' })],
    };

    // 5. 运行工作流
    await runWorkflow(app, initialInput);

  } catch (error) {
    logger.error('主函数发生未处理错误:', error);
    process.exit(1);
  }
}

main();
