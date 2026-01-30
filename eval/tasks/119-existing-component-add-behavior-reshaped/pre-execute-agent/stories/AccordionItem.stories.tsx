import type { Meta, StoryObj } from '@storybook/react';
import AccordionItem from '../src/components/AccordionItem';

const meta = {
	title: 'Layout/AccordionItem',
	component: AccordionItem,
	args: {
		title: 'What is this product?',
		children:
			'This is a comprehensive solution for managing your workflow efficiently.',
	},
} satisfies Meta<typeof AccordionItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const Expanded: Story = {
	args: {
		defaultExpanded: true,
	},
};

export const LongContent: Story = {
	args: {
		title: 'Tell me more about the features',
		children:
			'Our product includes a wide range of features designed to streamline your operations. From automated workflows to real-time collaboration tools, we provide everything you need to succeed. Additional features include advanced analytics, customizable dashboards, and seamless integrations with popular third-party services.',
	},
};

export const ShortTitle: Story = {
	args: {
		title: 'FAQ',
		children: 'Frequently asked questions section.',
	},
};
