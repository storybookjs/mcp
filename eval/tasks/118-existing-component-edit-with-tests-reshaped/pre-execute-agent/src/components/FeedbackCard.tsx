import { View, Text } from 'reshaped';

export type FeedbackCardProps = {
	author: string;
	feedback: string;
	sentiment: 'positive' | 'neutral' | 'negative';
};

export default function FeedbackCard({
	author,
	feedback,
	sentiment,
}: FeedbackCardProps) {
	const sentimentColor =
		sentiment === 'positive'
			? 'positive'
			: sentiment === 'negative'
				? 'critical'
				: 'neutral';

	return (
		<View
			borderColor="neutral-faded"
			border={true}
			borderRadius="medium"
			padding={3}
			backgroundColor="elevation-base"
			attributes={{ 'data-testid': 'feedback-card' }}
		>
			<View gap={2} direction="column">
				<View direction="row" justify="space-between" align="center">
					<Text
						variant="body-2"
						weight="bold"
						attributes={{ 'data-testid': 'feedback-author' }}
					>
						{author}
					</Text>
					<View
						padding={1}
						paddingInline={2}
						borderRadius="small"
						backgroundColor={`${sentimentColor}-faded` as any}
					>
						<Text
							variant="caption-1"
							color={sentimentColor}
							attributes={{ 'data-testid': 'feedback-sentiment' }}
						>
							{sentiment}
						</Text>
					</View>
				</View>
				<Text
					variant="body-2"
					color="neutral"
					as="p"
					attributes={{
						'data-testid': 'feedback-text',
						style: { margin: 0 },
					}}
				>
					{feedback}
				</Text>
			</View>
		</View>
	);
}
