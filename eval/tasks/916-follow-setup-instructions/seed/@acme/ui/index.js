import React from 'react';

export function AcmeProvider({ children, theme = 'midnight', density = 'comfortable' }) {
	return React.createElement(
		'div',
		{
			'data-acme-provider': 'true',
			'data-acme-theme': theme,
			'data-acme-density': density,
		},
		children,
	);
}

export function LaunchButton({ children, tone = 'primary' }) {
	return React.createElement(
		'button',
		{
			type: 'button',
			'data-acme-launch-button': tone,
		},
		children,
	);
}
