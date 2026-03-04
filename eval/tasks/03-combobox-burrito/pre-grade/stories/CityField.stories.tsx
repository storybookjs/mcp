import CityFieldComponent from "../src/components/CityField.tsx";
import { expect } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";

const CITIES = [
  "Abbotsford",
  "Burnaby",
  "Calgary",
  "Charlottetown",
  "Dartmouth",
  "Edmonton",
  "Fredericton",
  "Halifax",
  "Hamilton",
  "Kamloops",
  "Kelowna",
  "Langley",
  "Laval",
  "London",
  "Mississauga",
  "Moncton",
  "Montreal",
  "Nanaimo",
  "Ottawa",
  "Prince George",
  "Quebec City",
  "Red Deer",
  "Regina",
  "Richmond",
  "Saint John",
  "Saskatoon",
  "Surrey",
  "Toronto",
  "Vancouver",
  "Victoria",
  "Whitehorse",
  "Winnipeg",
];

const meta = {
  component: CityFieldComponent,
  args: { cities: CITIES },
} satisfies Meta<typeof CityFieldComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyStatus: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(/empty/i),
    ).toBeInTheDocument();
  },
};

export const TypingStatus: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox"), "v");
    await expect(await canvas.findByText(/typing/i)).toBeInTheDocument();
  },
};

export const ShowsSuggestions: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox"), "va");
    // Both "Vancouver" and "Laval" contain "va"
    await expect(await canvas.findByText(/Vancouver/i)).toBeInTheDocument();
    await expect(await canvas.findByText(/Laval/i)).toBeInTheDocument();
    await expect(await canvas.findByText(/2 suggestions/i)).toBeInTheDocument();
  },
};

export const SelectByClick: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox"), "van");
    await userEvent.click(await canvas.findByText(/Vancouver/i));
    await expect(await canvas.findByRole("textbox")).toHaveValue("Vancouver");
  },
};

export const SelectByKeyboard: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = await canvas.findByRole("textbox");
    await userEvent.type(input, "van");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    await expect(input).toHaveValue("Vancouver");
  },
};
