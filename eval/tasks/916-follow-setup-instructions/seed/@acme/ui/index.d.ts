import type { ReactNode } from 'react';

export type AcmeProviderProps = {
	children?: ReactNode;
	theme: 'midnight';
	density: 'comfortable';
};

export declare function AcmeProvider(props: AcmeProviderProps): ReactNode;

export type LaunchButtonProps = {
	children?: ReactNode;
	tone?: 'primary' | 'secondary';
};

export declare function LaunchButton(props: LaunchButtonProps): ReactNode;
