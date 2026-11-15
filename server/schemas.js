// Structured-output schemas. Every field is required (use "" or [] when empty)
// so the model's JSON always has the same shape the frontend expects.
import { z } from "zod";

export const BoardItem = z.object({
  kind: z
    .enum(["heading", "point", "keyterm", "code", "diagram", "example", "warning"])
    .describe(
      "heading=section title; point=short bullet; keyterm=term + meaning; code=Python/SQL snippet; " +
        "diagram=Mermaid flowchart source in body; example=worked example; warning=common mistake"
    ),
  title: z.string().describe("Short text written on the whiteboard (max ~12 words)"),
  body: z
    .string()
    .describe("Extra content: code for kind=code, Mermaid source for kind=diagram, meaning for keyterm, else \"\""),
});

// One teaching step: the avatar says `say` while `board` is drawn on the whiteboard.
export const Step = z.object({
  say: z.string().describe("What the tutor speaks aloud. Plain sentences, no markdown, no symbols read aloud."),
  board: z.array(BoardItem).describe("0-2 whiteboard items drawn while this is spoken"),
});

export const CheckQuestion = z.object({
  question: z.string(),
  idealAnswer: z.string(),
  concept: z.string(),
});

export const PageLesson = z.object({
  steps: z.array(Step).describe("4-8 steps covering the page in order"),
  checkQuestion: CheckQuestion.describe("One quick oral question to confirm understanding of this page"),
});

export const TutorReply = z.object({
  steps: z.array(Step).describe("1-4 steps answering the student"),
  verdict: z
    .enum(["understood", "not_yet", "not_applicable"])
    .describe("If the student was answering the check question: understood / not_yet. Otherwise not_applicable."),
});

export const Question = z.object({
  id: z.string(),
  type: z.enum(["mcq", "short", "predict_output"]),
  concept: z.string().describe("Must exactly match one concept name from the concepts list"),
  question: z.string(),
  code: z.string().describe("Code snippet for the question, or \"\""),
  options: z.array(z.string()).describe("4 options for mcq, [] otherwise"),
  answer: z.string().describe("For mcq: the exact correct option text. Otherwise the model answer."),
  explanation: z.string(),
});

export const Quiz = z.object({
  concepts: z.array(z.string()).describe("5-10 important concepts of this chapter (short names)"),
  questions: z.array(Question),
});

export const Grades = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      correct: z.boolean(),
      feedback: z.string().describe("One or two encouraging sentences to the student"),
      misconception: z.string().describe("What the student seems to misunderstand, or \"\" if correct"),
    })
  ),
});

export const Remediation = z.object({
  steps: z.array(Step).describe("4-7 steps re-teaching the concept a NEW way"),
  practice: z.array(Question).describe("Exactly 2 fresh questions on this concept"),
});
