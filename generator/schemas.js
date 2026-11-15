// Shapes of the content the generator asks Claude for. Every field is required
// (use "" or [] when empty) so the offline app can rely on the same structure.
import { z } from "zod";

export const BoardItem = z.object({
  kind: z
    .enum(["heading", "point", "keyterm", "code", "diagram", "example", "warning"])
    .describe(
      "heading=section title; point=short bullet; keyterm=term + meaning; code=Python/SQL/C++ snippet; " +
        "diagram=Mermaid flowchart source in body; example=worked example; warning=common mistake"
    ),
  title: z.string().describe("Short text written on the whiteboard (max ~12 words)"),
  body: z.string().describe('Code for kind=code, Mermaid source for kind=diagram, meaning for keyterm, else ""'),
});

// The robot says `say` while `board` items are drawn.
export const Step = z.object({
  say: z.string().describe("What the tutor speaks aloud. Plain sentences, no markdown, no symbols read aloud."),
  board: z.array(BoardItem).describe("0-2 whiteboard items drawn while this is spoken"),
});

const Keywords = z
  .array(z.string())
  .describe(
    "2-5 short key words/phrases a correct answer must mention, used for offline checking. Include the English " +
      "term and, when teaching in Tamil, the Tamil term as separate entries (e.g. \"return\", \"திருப்பி அனுப்பு\")."
  );

export const CheckQuestion = z.object({
  question: z.string(),
  idealAnswer: z.string(),
  keywords: Keywords,
});

export const PageContent = z.object({
  steps: z.array(Step).describe("4-8 steps teaching the page in order"),
  explainAgain: z.array(Step).describe("2-4 steps re-explaining the page's main idea more simply, with an everyday analogy"),
  example: z.array(Step).describe("1-3 steps with one fully worked example (code with output where relevant)"),
  checkQuestion: CheckQuestion.describe("One short oral question checking the main idea of this page"),
});

export const Question = z.object({
  id: z.string(),
  type: z.enum(["mcq", "short", "predict_output"]),
  concept: z.string().describe("Must exactly match one concept name from the concepts list"),
  question: z.string(),
  code: z.string().describe('Code snippet for the question, or ""'),
  options: z.array(z.string()).describe("4 options for mcq, [] otherwise"),
  answer: z.string().describe("mcq: the exact correct option text. predict_output: the exact output. short: a model answer (1-2 sentences)."),
  keywords: Keywords.describe("For short answers: 2-5 key words/phrases. [] for mcq and predict_output."),
  explanation: z.string().describe("Why this is the answer, 1-2 sentences"),
});

export const QuestionBank = z.object({
  concepts: z.array(z.string()).describe("5-10 important concepts of this chapter (short names)"),
  questions: z.array(Question).describe("The question bank"),
});

export const ConceptReteach = z.object({
  variants: z
    .array(
      z.object({
        steps: z.array(Step).describe("4-7 steps re-teaching the concept"),
        practice: z.array(Question).describe("Exactly 2 practice questions on this concept"),
      })
    )
    .describe("Exactly 3 variants, each explaining the concept in a clearly different way"),
});
