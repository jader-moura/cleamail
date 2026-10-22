import { screen, waitFor } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";
import { NOW, aDecision, aStatus, anEmail, fakeApi, renderApp } from "./test/render.js";

describe("the dashboard", () => {
  it("shows the mailbox it is connected to", async () => {
    fakeApi();
    renderApp(<App now={NOW} />);

    expect(await screen.findByText(/you@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "cleamail" })).toBeInTheDocument();
  });

  it("says what to run when there is nothing waiting", async () => {
    fakeApi();
    renderApp(<App now={NOW} />);

    expect(await screen.findByText(/Nothing is waiting/)).toBeInTheDocument();
    expect(screen.getByText("cleamail run")).toBeInTheDocument();
  });

  it("shows a preview with its counts, and nothing applied yet", async () => {
    fakeApi({
      decisions: [
        aDecision({ id: 1, dryRun: true, runId: "preview-1" }),
        aDecision({
          id: 2,
          dryRun: true,
          runId: "preview-1",
          emailId: "msg-2",
          category: "important",
          explanation: "It is a payment confirmation.",
          actions: [
            { id: 3, type: "star", outcome: "applied", at: NOW.toISOString(), reversible: true },
          ],
        }),
      ],
      emails: [anEmail(), anEmail({ id: "msg-2", subject: "Your payment went through" })],
    });

    renderApp(<App now={NOW} />);

    expect(await screen.findByText(/went through 2 emails/)).toBeInTheDocument();
    expect(screen.getByText(/clear 1 email out of the inbox/)).toBeInTheDocument();
    // The mail arrives in a second request, so the row waits for it rather than the panel.
    expect(await screen.findByText("Half price everything")).toBeInTheDocument();
    expect(screen.getByText("It offers a discount.")).toBeInTheDocument();
  });

  it("applies the run the user was shown when they approve", async () => {
    const api = fakeApi({
      decisions: [aDecision({ dryRun: true, runId: "preview-7" })],
      emails: [anEmail()],
    });

    renderApp(<App now={NOW} />);

    await userEvent.click(await screen.findByRole("button", { name: /Approve and apply/ }));

    await waitFor(() => {
      expect(api.calls.some((call) => call.url.startsWith("/api/apply"))).toBe(true);
    });

    const applied = api.calls.find((call) => call.url.startsWith("/api/apply"));

    expect(applied?.body).toStrictEqual({ runId: "preview-7" });
  });

  it("offers nothing to approve on a read-only mailbox, and says why", async () => {
    fakeApi({
      status: aStatus({
        mailbox: {
          address: "you@example.com",
          kind: "gmail",
          canModify: false,
          messages: 10,
        },
      }),
      decisions: [aDecision({ dryRun: true, runId: "preview-1" })],
      emails: [anEmail()],
    });

    renderApp(<App now={NOW} />);

    expect(await screen.findByRole("button", { name: /Approve and apply/ })).toBeDisabled();
    expect(screen.getByText(/connected read-only/)).toBeInTheDocument();
  });

  it("will not offer to act when it could not tell what the connection allows", async () => {
    fakeApi({
      status: aStatus({
        mailbox: { address: "you@example.com", kind: "gmail", messages: 3 },
      }),
      decisions: [aDecision({ dryRun: true, runId: "preview-1" })],
      emails: [anEmail()],
    });

    renderApp(<App now={NOW} />);

    expect(await screen.findByRole("button", { name: /Approve and apply/ })).toBeDisabled();
    expect(
      screen.getByText(/could not tell what this connection is allowed to do/),
    ).toBeInTheDocument();
  });

  it("lists what was cleaned, with the reason on every row", async () => {
    fakeApi({ decisions: [aDecision()], emails: [anEmail()] });
    renderApp(<App now={NOW} />);

    expect(screen.getByText("Cleaned")).toBeInTheDocument();
    expect(await screen.findByText("Half price everything")).toBeInTheDocument();
    expect(screen.getByText("It offers a discount.")).toBeInTheDocument();
    expect(screen.getByText(/label it, archive it/)).toBeInTheDocument();
    expect(screen.getByText(/1 email out of the inbox/)).toBeInTheDocument();
  });

  it("undoes one email from its row", async () => {
    const api = fakeApi({ decisions: [aDecision()], emails: [anEmail()] });
    renderApp(<App now={NOW} />);

    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => {
      expect(api.calls.some((call) => call.url.startsWith("/api/undo"))).toBe(true);
    });

    expect(api.calls.find((call) => call.url.startsWith("/api/undo"))?.body).toStrictEqual({
      runId: "run-1",
      emailId: "msg-1",
    });
  });

  it("undoes the whole run from the panel", async () => {
    const api = fakeApi({ decisions: [aDecision()], emails: [anEmail()] });
    renderApp(<App now={NOW} />);

    await userEvent.click(await screen.findByRole("button", { name: /Undo the last run/ }));

    await waitFor(() => {
      expect(api.calls.some((call) => call.url.startsWith("/api/undo"))).toBe(true);
    });

    expect(api.calls.find((call) => call.url.startsWith("/api/undo"))?.body).toStrictEqual({});
  });

  it("will not offer to undo something already undone", async () => {
    fakeApi({
      decisions: [
        aDecision({
          actions: [
            {
              id: 1,
              type: "archive",
              outcome: "reversed",
              at: NOW.toISOString(),
              reversedAt: NOW.toISOString(),
              reversible: false,
            },
          ],
        }),
      ],
      emails: [anEmail()],
    });

    renderApp(<App now={NOW} />);

    expect(await screen.findByRole("button", { name: "Undone" })).toBeDisabled();
  });

  it("separates what cleamail was unsure about", async () => {
    fakeApi({
      decisions: [
        aDecision({
          id: 5,
          category: undefined,
          confidence: undefined,
          reviewReason: "invalid_model_output",
          explanation: "The model answered with reasoning and no classification.",
          actions: [
            { id: 9, type: "label", outcome: "applied", at: NOW.toISOString(), reversible: true },
          ],
        }),
      ],
      emails: [anEmail()],
    });

    renderApp(<App now={NOW} />);

    expect(await screen.findByText("cleamail was unsure")).toBeInTheDocument();
    expect(
      screen.getByText(/Waiting for you because the model's answer could not be used/),
    ).toBeInTheDocument();
  });

  it("says what went wrong rather than showing an empty page", async () => {
    fakeApi({ failures: { "/api/decisions": 500 } });
    renderApp(<App now={NOW} />);

    expect(await screen.findByText(/Could not load the decisions/)).toBeInTheDocument();
    expect(screen.getByText("The database is locked.")).toBeInTheDocument();
  });

  it("shows the log of what it did", async () => {
    fakeApi({
      audit: [
        {
          id: 1,
          at: NOW.toISOString(),
          kind: "apply",
          summary: "Applied 2 action(s) to 1 email(s)",
        },
      ],
    });

    renderApp(<App now={NOW} />);

    expect(await screen.findByText("Applied 2 action(s) to 1 email(s)")).toBeInTheDocument();
  });
});
