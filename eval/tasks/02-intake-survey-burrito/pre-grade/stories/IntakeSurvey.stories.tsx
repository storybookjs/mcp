import IntakeSurveyComponent from "../src/components/IntakeSurvey.tsx";
import { fn, expect } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  component: IntakeSurveyComponent,
  args: {
    onSubmit: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof IntakeSurveyComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Initial: Story = {};

export const OnCancel: Story = {
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: /Cancel/i }),
    );
    await expect(args.onCancel).toHaveBeenCalledOnce();
  },
};

export const WithErrors: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText(/Full name/i),
      "Jane Burrito",
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: /Submit/i }),
    );
    await expect(
      await canvas.findByText(/At least one condition must be selected/),
    ).toBeInTheDocument();
  },
};

export const OnSubmit: Story = {
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText(/Full name/i),
      "Jane Burrito",
    );
    await userEvent.click(
      await canvas.findByRole("checkbox", { name: /Acne/i }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: /Submit/i }),
    );
    await expect(args.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "Jane Burrito",
        conditions: expect.arrayContaining([expect.stringMatching(/Acne/i)]),
      }),
    );
  },
};
