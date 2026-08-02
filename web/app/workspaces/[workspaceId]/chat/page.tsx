import { EmptyState } from "@/components/EmptyState";

export default function ChatIndexPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState title="Selecione uma conversa" description="Ou crie uma nova conversa para começar a falar com o Vorix." />
    </div>
  );
}
