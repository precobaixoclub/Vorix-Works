export type CalendarEventType = "campaign" | "post";

export type CalendarEvent = {
  id: string;
  date: string;
  title: string;
  type: CalendarEventType;
  status: string;
};
