<!-- README START -->

# Storybook Addon Kit ([demo](https://main--601ada52c3d4040021afdc30.chromatic.com))

Simplify the creation of Storybook addons

- 📝 Live-editing in development
- ⚛️ React/JSX support
- 📦 Transpiling and bundling with [tsup](https://tsup.egoist.dev/)
- 🏷 Plugin metadata
- 🚢 Release management with [Auto](https://github.com/intuit/auto)
- 🧺 Boilerplate and sample code
- 🛄 ESM support
- 🛂 TypeScript by default with option to eject to JS

### Migrating to a later Storybook version

If you have an existing addon that you want to migrate to support the latest version of Storyboook, you can check out the [addon migration guide](https://storybook.js.org/docs/addons/addon-migration-guide).

## Getting Started

Click the **Use this template** button to get started.

![](https://user-images.githubusercontent.com/321738/125058439-8d9ef880-e0aa-11eb-9211-e6d7be812959.gif)

Clone your repository and install dependencies.

```sh
npm install
```

<!-- README END -->

### Development scripts

- `npm run start` runs babel in watch mode and starts Storybook
- `npm run build` build and package your addon code

### Switch from TypeScript to JavaScript

Don't want to use TypeScript? We offer a handy eject command: `npm run eject-ts`

This will convert all code to JS. It is a destructive process, so we recommended running this before you start writing any code.

## What's included?

![Demo](https://user-images.githubusercontent.com/42671/107857205-e7044380-6dfa-11eb-8718-ad02e3ba1a3f.gif)

The addon code lives in `src`. It demonstrates all core addon related concepts. The three [UI paradigms](https://storybook.js.org/docs/react/addons/addon-types#ui-based-addons)

- `src/Tool.tsx`
- `src/Panel.tsx`
- `src/Tab.tsx`

Which, along with the addon itself, are registered in `src/manager.ts`.

Managing State and interacting with a story:

- `src/withGlobals.ts` & `src/Tool.tsx` demonstrates how to use `useGlobals` to manage global state and modify the contents of a Story.
- `src/withRoundTrip.ts` & `src/Panel.tsx` demonstrates two-way communication using channels.
- `src/Tab.tsx` demonstrates how to use `useParameter` to access the current story's parameters.

Your addon might use one or more of these patterns. Feel free to delete unused code. Update `src/manager.ts` and `src/preview.ts` accordingly.

Lastly, configure you addon name in `src/constants.ts`.

### Bundling

Addons can interact with a Storybook project in multiple ways. It is recommended to familiarize yourself with [the basics](https://storybook.js.org/docs/react/addons/introduction) before getting started.

- Manager entries are used to add UI or behavior to the Storybook manager UI.
- Preview entries are used to add UI or behavior to the preview iframe where stories are rendered.
- Presets are used to modify the Storybook configuration, similar to how [users can configure their `main.ts` configurations](https://storybook.js.org/docs/react/api/main-config).

Since each of these places represents a different environment with different features and modules, it is also recommended to split and build your modules accordingly. This addon-kit comes with a preconfigured [bundling configuration](./tsup.config.ts) that supports this split, and you are free to modify and extend it as needed.

You can define which modules match which environments in the [`package.json#bundler`](./package.json) property:

- `exportEntries` is a list of module entries that users can manually import from anywhere they need to. For example, you could have decorators that users need to import into their `preview.ts` file or utility functions that can be used in their `main.ts` files.
- `managerEntries` is a list of module entries meant only for the manager UI. These modules will be bundled to ESM and won't include types since they are mostly loaded by Storybook directly.
- `previewEntries` is a list of module entries meant only for the preview UI. These modules will be bundled to ESM and won't include types since they are mostly loaded by Storybook directly.

Manager and preview entries are only used in the browser so they only output ESM modules. Export entries could be used both in the browser and in Node depending on their use case, so they both output ESM and CJS modules.

#### Globalized packages

Storybook provides a predefined set of packages that are available in the manager UI and the preview UI. In the final bundle of your addon, these packages should not be included. Instead, the imports should stay in place, allowing Storybook to replace those imports with the actual packages during the Storybook build process.

The list of packages differs between the manager and the preview, which is why there is a slight difference between `managerEntries` and `previewEntries`. Most notably, `react` and `react-dom` are prebundled in the manager but not in the preview. This means that your manager entries can use React to build UI without bundling it or having a direct reference to it. Therefore, it is safe to have React as a `devDependency` even though you are using it in production. _Requiring React as a peer dependency would unnecessarily force your users to install React._

An exception to this rule is if you are using React to inject UI into the preview, which does not come prebundled with React. In such cases, you need to move `react` and `react-dom` to a peer dependency. However, we generally advise against this pattern since it would limit the usage of your addon to React-based Storybooks.

### Metadata

Storybook addons are listed in the [catalog](https://storybook.js.org/addons) and distributed via npm. The catalog is populated by querying npm's registry for Storybook-specific metadata in `package.json`. This project has been configured with sample data. Learn more about available options in the [Addon metadata docs](https://storybook.js.org/docs/react/addons/addon-catalog#addon-metadata).

## Documentation

To help the community use your addon and understand its capabilities, please document it thoroughly.

To get started, replace this README with the content in this sample template.

### Sample documentation template

````md
# My Addon

## Installation

First, install the package.

```sh
npm install --save-dev my-addon
```

Then, register it as an addon in `.storybook/main.js`.

```ts
// .storybook/main.ts

// Replace your-framework with the framework you are using (e.g., react-webpack5, vue3-vite)
import type { StorybookConfig } from '@storybook/your-framework';

const config: StorybookConfig = {
  // ...rest of config
  addons: [
    '@storybook/addon-docs'
    'my-addon', // 👈 register the addon here
  ],
};

export default config;
```

## Usage

The primary way to use this addon is to define the `exampleParameter` parameter. You can do this the
component level, as below, to affect all stories in the file, or you can do it for a single story.

```ts
// Button.stories.ts

// Replace your-framework with the name of your framework
import type { Meta } from '@storybook/your-framework';

import { Button } from './Button';

const meta: Meta<typeof Button> = {
  component: Button,
  parameters: {
    myAddon: {
      exampleParameter: true,
      // See API section below for available parameters
    }
  }
};

export default meta;
```

Another way to use the addon is...

## API

### Parameters

This addon contributes the following parameters to Storybook, under the `myAddon` namespace:

#### `disable`

Type: `boolean`

Disable this addon's behavior. This parameter is most useful to allow overriding at more specific
levels. For example, if this parameter is set to true at the project level, it could then be
re-enabled by setting it to false at the meta (component) or story level.

### Options

When registering this addon, you can configure it with the following options, which are passed when
registering the addon, like so:

```ts
// .storybook/main.ts

// Replace your-framework with the framework you are using (e.g., react-webpack5, vue3-vite)
import type { StorybookConfig } from "@storybook/your-framework";

const config: StorybookConfig = {
  // ...rest of config
  addons: [
    "@storybook/addon-docs",
    {
      name: "my-addon",
      options: {
        // 👈 options for my-addon go here
      },
    },
  ],
};

export default config;
```

#### `useExperimentalBehavior`

Type: `boolean`

Enable experimental behavior to...
````

## Release Management

### Setup

This project is configured to use [auto](https://github.com/intuit/auto) for release management. It generates a changelog and pushes it to both GitHub and npm. Therefore, you need to configure access to both:

- [`NPM_TOKEN`](https://docs.npmjs.com/creating-and-viewing-access-tokens#creating-access-tokens) Create a token with both _Read and Publish_ permissions.
- [`GH_TOKEN`](https://github.com/settings/tokens) Create a token with the `repo` scope.

Then open your `package.json` and edit the following fields:

- `name`
- `author`
- `repository`

#### Local

To use `auto` locally create a `.env` file at the root of your project and add your tokens to it:

```bash
GH_TOKEN=<value you just got from GitHub>
NPM_TOKEN=<value you just got from npm>
```

Lastly, **create labels on GitHub**. You’ll use these labels in the future when making changes to the package.

```bash
npx auto create-labels
```

If you check on GitHub, you’ll now see a set of labels that `auto` would like you to use. Use these to tag future pull requests.

#### GitHub Actions

This template comes with GitHub actions already set up to publish your addon anytime someone pushes to your repository.

Go to `Settings > Secrets`, click `New repository secret`, and add your `NPM_TOKEN`.

### Creating a release

To create a release locally you can run the following command, otherwise the GitHub action will make the release for you.

```sh
npm run release
```

That will:

- Build and package the addon code
- Bump the version
- Push a release to GitHub and npm
- Push a changelog to GitHub
