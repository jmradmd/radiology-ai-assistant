import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./markdown";

test("renders single line breaks as explicit markdown breaks", () => {
  const html = renderToStaticMarkup(
    <Markdown content={"Line one\nLine two"} stripEmojis={false} />
  );

  assert.equal(html.includes("<br"), true);
});

test("keeps heading structure when markdown headings are provided", () => {
  const html = renderToStaticMarkup(
    <Markdown
      content={`## Recommendation

Use transvaginal ultrasound for first-line evaluation.`}
      stripEmojis={false}
    />
  );

  assert.equal(html.includes("<h2"), true);
  assert.equal(html.includes("Recommendation"), true);
});

test("maps citation icons to exact normalized source titles", () => {
  const html = renderToStaticMarkup(
    <Markdown
      content={`Answer text [Source: "Retained products of conception - Ultrasound"]`}
      stripEmojis={false}
      sources={[
        {
          title: "Retained Products of Conception Ultrasound",
          url: "/api/policies/rpoc.pdf",
          content: "Reference excerpt",
        },
      ]}
    />
  );

  assert.equal(
    html.includes('aria-label="Open citation source: Retained Products of Conception Ultrasound"'),
    true
  );
});

test("does not guess ambiguous citation title matches", () => {
  const html = renderToStaticMarkup(
    <Markdown
      content={`Answer text [Source: "Pelvic Ultrasound Reference"]`}
      stripEmojis={false}
      sources={[
        { title: "Pelvic Ultrasound Reference A", url: "/api/policies/ref-a.pdf" },
        { title: "Pelvic Ultrasound Reference B", url: "/api/policies/ref-b.pdf" },
      ]}
    />
  );

  assert.equal(
    html.includes('aria-label="Open citation source: Pelvic Ultrasound Reference"'),
    true
  );
  assert.equal(
    html.includes('aria-label="Open citation source: Pelvic Ultrasound Reference A"'),
    false
  );
  assert.equal(
    html.includes('aria-label="Open citation source: Pelvic Ultrasound Reference B"'),
    false
  );
});
