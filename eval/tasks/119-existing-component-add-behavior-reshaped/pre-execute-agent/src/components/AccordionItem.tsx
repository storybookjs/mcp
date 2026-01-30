import { useState } from 'react';
import { View, Text, Button } from 'reshaped';

export type AccordionItemProps = {
	title: string;
	children: React.ReactNode;
	defaultExpanded?: boolean;
};

export default function AccordionItem({
	title,
	children,
	defaultExpanded = false,
}: AccordionItemProps) {
	const [isExpanded, setIsExpanded] = useState(defaultExpanded);

	// BUG: This function doesn't actually toggle the state
	const handleToggle = () => {
		// Missing: setIsExpanded(!isExpanded);
	};

	return (
		<View
			borderColor="neutral-faded"
			border={true}
			borderRadius="medium"
			backgroundColor="elevation-base"
			attributes={{ 'data-testid': 'accordion-item' }}
		>
			<View
				padding={3}
				direction="row"
				justify="space-between"
				align="center"
				attributes={{
					onClick: handleToggle,
					style: { cursor: 'pointer' },
					role: 'button',
					'aria-expanded': isExpanded,
					'data-testid': 'accordion-header',
				}}
			>
				<Text
					variant="body-2"
					weight="bold"
					attributes={{ 'data-testid': 'accordion-title' }}
				>
					{title}
				</Text>
				<Text variant="body-2">{isExpanded ? '−' : '+'}</Text>
			</View>
			{isExpanded && (
				<View
					padding={3}
					paddingTop={0}
					attributes={{ 'data-testid': 'accordion-content' }}
				>
					<Text variant="body-2" color="neutral">
						{children}
					</Text>
				</View>
			)}
		</View>
	);
}
