  import * as React from "react"
  import { cleanup, render, screen } from "@testing-library/react"

  import FeaturedBadge from "../featured-badge"

  describe("FeaturedBadge", () => {
    it("should render the icon without errors", async () => {
      render(<FeaturedBadge data-testid="icon" />)


      const svgElement = screen.getByTestId("icon")

      expect(svgElement).toBeInTheDocument()

      cleanup()
    })
  })