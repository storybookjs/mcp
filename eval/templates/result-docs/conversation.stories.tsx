import type { Meta, StoryObj } from '@storybook/react-vite';
import { Conversation } from './conversation';

const meta = {
	title: 'Result Docs/Conversation',
	component: Conversation,
	parameters: {
		layout: 'fullscreen',
	},
	tags: ['autodocs'],
} satisfies Meta<typeof Conversation>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A minimal successful conversation with basic system info and result.
 */
export const MinimalConversation: Story = {
	args: {
		prompt: 'Create a simple button component',
		promptTokenCount: 25,
		promptCost: 0.001,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: ['Read', 'Write', 'Bash'],
				mcp_servers: [],
				cwd: '/Users/dev/project',
				claude_code_version: '0.1.0',
				ms: 120,
				tokenCount: 1500,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'text',
							text: "I'll create a simple button component for you.",
						},
					],
					usage: {
						input_tokens: 1500,
						output_tokens: 150,
					},
				},
				ms: 2500,
				tokenCount: 150,
			},
			{
				type: 'result',
				subtype: 'success',
				duration_ms: 5000,
				duration_api_ms: 4500,
				num_turns: 2,
				total_cost_usd: 0.05,
				ms: 100,
				tokenCount: 50,
			},
		],
	},
};

/**
 * Conversation with MCP server connected.
 */
export const WithMCPServer: Story = {
	args: {
		prompt: 'Build a flight booking form using the component library',
		promptTokenCount: 45,
		promptCost: 0.002,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: [
					'Read',
					'Write',
					'Bash',
					'mcp__storybook_list-all-documentation',
					'mcp__storybook_get-component-documentation',
				],
				mcp_servers: [{ name: 'storybook', status: 'connected' }],
				cwd: '/Users/dev/project',
				claude_code_version: '0.1.0',
				ms: 150,
				tokenCount: 2000,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'text',
							text: "I'll help you build a flight booking form. Let me first check what components are available.",
						},
					],
					usage: {
						input_tokens: 2000,
						output_tokens: 200,
					},
				},
				ms: 3000,
				tokenCount: 200,
			},
			{
				type: 'result',
				subtype: 'success',
				duration_ms: 8000,
				duration_api_ms: 7200,
				num_turns: 3,
				total_cost_usd: 0.12,
				ms: 120,
				tokenCount: 80,
			},
		],
	},
};

/**
 * Conversation with multiple MCP servers, some disconnected.
 */
export const MultipleServersWithFailure: Story = {
	args: {
		prompt: 'Create a dashboard with charts',
		promptTokenCount: 35,
		promptCost: 0.0015,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: [
					'Read',
					'Write',
					'Bash',
					'mcp__storybook_list-all-documentation',
					'mcp__charts_get-chart-types',
				],
				mcp_servers: [
					{ name: 'storybook', status: 'connected' },
					{ name: 'charts', status: 'disconnected' },
					{ name: 'database', status: 'connected' },
				],
				cwd: '/Users/dev/project',
				claude_code_version: '0.1.0',
				ms: 180,
				tokenCount: 2500,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'text',
							text: "I'll create a dashboard. I notice the charts MCP server is disconnected, but I can still proceed.",
						},
					],
					usage: {
						input_tokens: 2500,
						output_tokens: 180,
					},
				},
				ms: 2800,
				tokenCount: 180,
			},
			{
				type: 'result',
				subtype: 'success',
				duration_ms: 6500,
				duration_api_ms: 5800,
				num_turns: 2,
				total_cost_usd: 0.08,
				ms: 110,
				tokenCount: 70,
			},
		],
	},
};

/**
 * Conversation with tool usage (Write tool).
 */
export const WithWriteTool: Story = {
	args: {
		prompt: 'Create a Button component',
		promptTokenCount: 28,
		promptCost: 0.0012,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: ['Read', 'Write', 'Bash'],
				mcp_servers: [],
				cwd: '/Users/dev/project',
				claude_code_version: '0.1.0',
				ms: 100,
				tokenCount: 1500,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'tool_1',
							name: 'Write',
							input: {
								file_path: 'src/components/Button.tsx',
								content: `export interface ButtonProps {
  label: string;
  onClick: () => void;
}

export const Button = ({ label, onClick }: ButtonProps) => {
  return <button onClick={onClick}>{label}</button>;
};`,
							},
						},
					],
					usage: {
						input_tokens: 1500,
						output_tokens: 250,
					},
				},
				ms: 3200,
				tokenCount: 250,
			},
			{
				type: 'user',
				message: {
					content: [
						{
							tool_use_id: 'tool_1',
							type: 'tool_result',
							content: 'File written successfully',
						},
					],
				},
				ms: 50,
				tokenCount: 20,
			},
			{
				type: 'result',
				subtype: 'success',
				duration_ms: 5500,
				duration_api_ms: 5000,
				num_turns: 3,
				total_cost_usd: 0.06,
				ms: 100,
				tokenCount: 60,
			},
		],
	},
};

/**
 * Conversation with Edit tool showing diff.
 */
export const WithEditTool: Story = {
	args: {
		prompt: 'Add a variant prop to the Button',
		promptTokenCount: 32,
		promptCost: 0.0014,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: ['Read', 'Write', 'Edit', 'Bash'],
				mcp_servers: [],
				cwd: '/Users/dev/project',
				ms: 110,
				tokenCount: 1600,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'tool_1',
							name: 'Edit',
							input: {
								file_path: 'src/components/Button.tsx',
								old_string: `export interface ButtonProps {
  label: string;
  onClick: () => void;
}`,
								new_string: `export interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}`,
							},
						},
					],
					usage: {
						input_tokens: 1600,
						output_tokens: 280,
					},
				},
				ms: 3500,
				tokenCount: 280,
			},
			{
				type: 'user',
				message: {
					content: [
						{
							tool_use_id: 'tool_1',
							type: 'tool_result',
							content: 'File edited successfully',
						},
					],
				},
				ms: 60,
				tokenCount: 22,
			},
			{
				type: 'result',
				subtype: 'success',
				duration_ms: 6000,
				duration_api_ms: 5400,
				num_turns: 3,
				total_cost_usd: 0.07,
				ms: 110,
				tokenCount: 65,
			},
		],
	},
};

/**
 * Conversation with MCP tool usage.
 */
export const WithMCPTool: Story = {
	args: {
		prompt: 'List all available components',
		promptTokenCount: 30,
		promptCost: 0.0013,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: ['Read', 'Write', 'mcp__storybook_list-all-documentation'],
				mcp_servers: [{ name: 'storybook', status: 'connected' }],
				cwd: '/Users/dev/project',
				ms: 130,
				tokenCount: 1800,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'tool_1',
							name: 'mcp__storybook_list-all-documentation',
							input: {},
						},
					],
					usage: {
						input_tokens: 1800,
						output_tokens: 120,
					},
				},
				ms: 2500,
				tokenCount: 120,
			},
			{
				type: 'user',
				message: {
					content: [
						{
							tool_use_id: 'tool_1',
							type: 'tool_result',
							content: JSON.stringify([
								{
									type: 'text',
									text: JSON.stringify({
										components: [
											{ id: 'button', name: 'Button' },
											{ id: 'input', name: 'Input' },
											{ id: 'form', name: 'Form' },
										],
									}),
								},
							]),
						},
					],
				},
				ms: 80,
				tokenCount: 150,
			},
			{
				type: 'result',
				subtype: 'success',
				duration_ms: 4500,
				duration_api_ms: 4000,
				num_turns: 3,
				total_cost_usd: 0.055,
				ms: 95,
				tokenCount: 55,
			},
		],
	},
};

/**
 * Conversation with Bash tool execution.
 */
export const WithBashTool: Story = {
	args: {
		prompt: 'Run the tests',
		promptTokenCount: 18,
		promptCost: 0.0008,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: ['Read', 'Write', 'Bash'],
				mcp_servers: [],
				cwd: '/Users/dev/project',
				ms: 95,
				tokenCount: 1400,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'tool_1',
							name: 'Bash',
							input: {
								command: 'npm test',
							},
						},
					],
					usage: {
						input_tokens: 1400,
						output_tokens: 100,
					},
				},
				ms: 2000,
				tokenCount: 100,
			},
			{
				type: 'user',
				message: {
					content: [
						{
							tool_use_id: 'tool_1',
							type: 'tool_result',
							content: `PASS  src/components/Button.test.tsx
  Button
    ✓ renders correctly (15 ms)
    ✓ handles click events (8 ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total`,
						},
					],
				},
				ms: 5000,
				tokenCount: 180,
			},
			{
				type: 'result',
				subtype: 'success',
				duration_ms: 8500,
				duration_api_ms: 3200,
				num_turns: 3,
				total_cost_usd: 0.045,
				ms: 85,
				tokenCount: 48,
			},
		],
	},
};

/**
 * Conversation with error result.
 */
export const WithErrorResult: Story = {
	args: {
		prompt: 'Build a complex dashboard',
		promptTokenCount: 28,
		promptCost: 0.0012,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: ['Read', 'Write', 'Bash'],
				mcp_servers: [],
				cwd: '/Users/dev/project',
				ms: 105,
				tokenCount: 1550,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'text',
							text: "I'll start building the dashboard.",
						},
					],
					usage: {
						input_tokens: 1550,
						output_tokens: 120,
					},
				},
				ms: 2200,
				tokenCount: 120,
			},
			{
				type: 'result',
				subtype: 'error',
				duration_ms: 4000,
				duration_api_ms: 3500,
				num_turns: 2,
				total_cost_usd: 0.03,
				ms: 75,
				tokenCount: 40,
			},
		],
	},
};

/**
 * Conversation with long elapsed times between turns.
 */
export const WithLongElapsedTimes: Story = {
	args: {
		prompt: 'Create a full application',
		promptTokenCount: 25,
		promptCost: 0.001,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: ['Read', 'Write', 'Bash'],
				mcp_servers: [],
				cwd: '/Users/dev/project',
				ms: 100,
				tokenCount: 1500,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'text',
							text: 'Starting to create the application structure.',
						},
					],
					usage: {
						input_tokens: 1500,
						output_tokens: 150,
					},
				},
				ms: 15000, // 15 seconds - shows high percentage
				tokenCount: 150,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'text',
							text: 'Adding more components.',
						},
					],
					usage: {
						input_tokens: 1650,
						output_tokens: 200,
					},
				},
				ms: 8000,
				tokenCount: 200,
			},
			{
				type: 'result',
				subtype: 'success',
				duration_ms: 25000,
				duration_api_ms: 22000,
				num_turns: 3,
				total_cost_usd: 0.15,
				ms: 100,
				tokenCount: 75,
			},
		],
	},
};

/**
 * Conversation with Read tool showing file paths.
 */
export const WithReadTool: Story = {
	args: {
		prompt: 'Check the Button component',
		promptTokenCount: 24,
		promptCost: 0.001,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: ['Read', 'Write'],
				mcp_servers: [],
				cwd: '/Users/dev/project',
				ms: 90,
				tokenCount: 1450,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'tool_1',
							name: 'Read',
							input: {
								file_path: '/Users/dev/project/src/components/Button.tsx',
							},
						},
					],
					usage: {
						input_tokens: 1450,
						output_tokens: 110,
					},
				},
				ms: 1800,
				tokenCount: 110,
			},
			{
				type: 'user',
				message: {
					content: [
						{
							tool_use_id: 'tool_1',
							type: 'tool_result',
							content: `export const Button = () => {
  return <button>Click me</button>;
};`,
						},
					],
				},
				ms: 40,
				tokenCount: 50,
			},
			{
				type: 'result',
				subtype: 'success',
				duration_ms: 3500,
				duration_api_ms: 3000,
				num_turns: 3,
				total_cost_usd: 0.04,
				ms: 80,
				tokenCount: 45,
			},
		],
	},
};

/**
 * Conversation with Glob tool.
 */
export const WithGlobTool: Story = {
	args: {
		prompt: 'Find all component files',
		promptTokenCount: 22,
		promptCost: 0.0009,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: ['Read', 'Write', 'Glob'],
				mcp_servers: [],
				cwd: '/Users/dev/project',
				ms: 88,
				tokenCount: 1420,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'tool_1',
							name: 'Glob',
							input: {
								pattern: 'src/components/**/*.tsx',
							},
						},
					],
					usage: {
						input_tokens: 1420,
						output_tokens: 95,
					},
				},
				ms: 1600,
				tokenCount: 95,
			},
			{
				type: 'user',
				message: {
					content: [
						{
							tool_use_id: 'tool_1',
							type: 'tool_result',
							content: `src/components/Button.tsx
src/components/Input.tsx
src/components/Form.tsx`,
						},
					],
				},
				ms: 35,
				tokenCount: 45,
			},
			{
				type: 'result',
				subtype: 'success',
				duration_ms: 3200,
				duration_api_ms: 2800,
				num_turns: 3,
				total_cost_usd: 0.038,
				ms: 75,
				tokenCount: 42,
			},
		],
	},
};

/**
 * Complex conversation with many turns and mixed tools.
 */
export const ComplexConversation: Story = {
	args: {
		prompt: 'Build a complete flight booking form with validation',
		promptTokenCount: 52,
		promptCost: 0.002,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: [
					'Read',
					'Write',
					'Edit',
					'Bash',
					'Glob',
					'mcp__storybook_list-all-documentation',
					'mcp__storybook_get-component-documentation',
				],
				mcp_servers: [{ name: 'storybook', status: 'connected' }],
				cwd: '/Users/dev/project',
				claude_code_version: '0.1.0',
				ms: 150,
				tokenCount: 2500,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'text',
							text: "I'll help you build a flight booking form. Let me first check what components are available.",
						},
					],
					usage: {
						input_tokens: 2500,
						output_tokens: 180,
					},
				},
				ms: 3000,
				tokenCount: 180,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'tool_1',
							name: 'mcp__storybook_list-all-documentation',
							input: {},
						},
					],
					usage: {
						input_tokens: 2680,
						output_tokens: 120,
					},
				},
				ms: 2800,
				tokenCount: 120,
			},
			{
				type: 'user',
				message: {
					content: [
						{
							tool_use_id: 'tool_1',
							type: 'tool_result',
							content: JSON.stringify([
								{
									type: 'text',
									text: JSON.stringify({
										components: [
											{ id: 'button', name: 'Button' },
											{ id: 'input', name: 'Input' },
											{ id: 'form', name: 'Form' },
											{ id: 'datepicker', name: 'DatePicker' },
										],
									}),
								},
							]),
						},
					],
				},
				ms: 100,
				tokenCount: 200,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'text',
							text: "Great! Now I'll create the flight booking form using these components.",
						},
					],
					usage: {
						input_tokens: 2880,
						output_tokens: 160,
					},
				},
				ms: 2500,
				tokenCount: 160,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'tool_2',
							name: 'Write',
							input: {
								file_path: 'src/components/FlightBookingForm.tsx',
								content: `import { Form } from './Form';
import { Input } from './Input';
import { DatePicker } from './DatePicker';
import { Button } from './Button';

export const FlightBookingForm = () => {
  return (
    <Form>
      <Input label="From" name="from" />
      <Input label="To" name="to" />
      <DatePicker label="Departure" name="departure" />
      <DatePicker label="Return" name="return" />
      <Button label="Search Flights" />
    </Form>
  );
};`,
							},
						},
					],
					usage: {
						input_tokens: 3040,
						output_tokens: 350,
					},
				},
				ms: 4500,
				tokenCount: 350,
			},
			{
				type: 'user',
				message: {
					content: [
						{
							tool_use_id: 'tool_2',
							type: 'tool_result',
							content: 'File written successfully',
						},
					],
				},
				ms: 55,
				tokenCount: 25,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'text',
							text: "Now let's add validation. I'll create a validation hook.",
						},
					],
					usage: {
						input_tokens: 3390,
						output_tokens: 140,
					},
				},
				ms: 2200,
				tokenCount: 140,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'tool_3',
							name: 'Write',
							input: {
								file_path: 'src/hooks/useFlightValidation.ts',
								content: `export const useFlightValidation = () => {
  const validate = (values: any) => {
    const errors: any = {};
    if (!values.from) errors.from = 'Required';
    if (!values.to) errors.to = 'Required';
    if (!values.departure) errors.departure = 'Required';
    return errors;
  };
  return { validate };
};`,
							},
						},
					],
					usage: {
						input_tokens: 3530,
						output_tokens: 280,
					},
				},
				ms: 3800,
				tokenCount: 280,
			},
			{
				type: 'user',
				message: {
					content: [
						{
							tool_use_id: 'tool_3',
							type: 'tool_result',
							content: 'File written successfully',
						},
					],
				},
				ms: 52,
				tokenCount: 24,
			},
			{
				type: 'result',
				subtype: 'success',
				duration_ms: 28000,
				duration_api_ms: 24500,
				num_turns: 10,
				total_cost_usd: 0.25,
				ms: 120,
				tokenCount: 100,
			},
		],
	},
};

/**
 * Conversation showing MCP tool with error in result.
 */
export const MCPToolWithError: Story = {
	args: {
		prompt: 'Get component documentation',
		promptTokenCount: 28,
		promptCost: 0.0012,
		messages: [
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-20250514',
				tools: ['mcp__storybook_get-component-documentation'],
				mcp_servers: [{ name: 'storybook', status: 'connected' }],
				cwd: '/Users/dev/project',
				ms: 110,
				tokenCount: 1600,
			},
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'tool_1',
							name: 'mcp__storybook_get-component-documentation',
							input: {
								componentId: 'nonexistent',
							},
						},
					],
					usage: {
						input_tokens: 1600,
						output_tokens: 130,
					},
				},
				ms: 2400,
				tokenCount: 130,
			},
			{
				type: 'user',
				message: {
					content: [
						{
							tool_use_id: 'tool_1',
							type: 'tool_result',
							content: JSON.stringify([
								{
									type: 'text',
									text: 'Component not found',
									isError: true,
								},
							]),
						},
					],
				},
				ms: 75,
				tokenCount: 35,
			},
			{
				type: 'result',
				subtype: 'error',
				duration_ms: 4200,
				duration_api_ms: 3700,
				num_turns: 3,
				total_cost_usd: 0.048,
				ms: 90,
				tokenCount: 50,
			},
		],
	},
};
