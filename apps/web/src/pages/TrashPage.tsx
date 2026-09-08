import React from "react";
import { useNavigate } from "react-router-dom";
import { TrashModal } from "@/components/TrashModal";

export default function TrashPage() {
  const navigate = useNavigate();

  return (
    <div className="h-screen w-screen bg-[#f9fafb] dark:bg-[#0d1117] flex items-center justify-center">
      <TrashModal
        open={true}
        onClose={() => navigate("/")}
      />
    </div>
  );
}
