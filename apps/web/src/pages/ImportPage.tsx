import React from "react";
import { useNavigate } from "react-router-dom";
import { ImportModal } from "@/components/ImportModal";

export default function ImportPage() {
  const navigate = useNavigate();

  return (
    <div className="h-screen w-screen bg-[#f9fafb] dark:bg-[#0d1117] flex items-center justify-center">
      <ImportModal
        open={true}
        onClose={() => navigate("/")}
      />
    </div>
  );
}
