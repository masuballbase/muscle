// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InBodyChart } from "./inbody-chart";
import { graphSeries } from "@/lib/inbody/model";
import { fixtureProfile, measurement } from "../../tests/fixtures/inbody";
afterEach(cleanup);
const now = new Date("2026-11-04T12:00:00Z");
it("renders two same-day measurements without a fictitious temporal connecting line and tap reveals values", () => {
  const series = graphSeries(
    [measurement("a"), measurement("b", undefined, "71")],
    ["weight"],
    fixtureProfile,
    "all",
    now,
    "Asia/Tokyo",
  );
  const { container } = render(<InBodyChart series={series} />);
  expect(container.querySelectorAll("circle")).toHaveLength(2);
  expect(container.querySelectorAll("polyline")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "2026-11-04 体重 71" }));
  expect(screen.getByRole("status").textContent).toContain("71");
});
it("one measurement is a single point and empty data has no SVG", () => {
  const view = render(
    <InBodyChart
      series={graphSeries(
        [measurement()],
        ["weight"],
        fixtureProfile,
        "all",
        now,
        "Asia/Tokyo",
      )}
    />,
  );
  expect(view.container.querySelectorAll("circle")).toHaveLength(1);
  view.rerender(<InBodyChart series={[]} />);
  expect(view.container.querySelector("svg")).toBeNull();
});
it("shows independent left/right values and supports keyboard selection", () => {
  render(
    <InBodyChart
      series={graphSeries(
        [measurement()],
        ["leftArm", "rightArm"],
        fixtureProfile,
        "all",
        now,
        "Asia/Tokyo",
      )}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "2026-11-04 左腕 0" }), {
    key: "Enter",
  });
  expect(screen.getByRole("status").textContent).toContain("左腕：0");
  expect(
    screen.getByRole("button", { name: "2026-11-04 右腕 0" }),
  ).toBeDefined();
});
