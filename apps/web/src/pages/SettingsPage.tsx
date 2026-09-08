import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SettingsModal } from "@/components/SettingsModal";

export default function SettingsPage() {
  const navigate = useNavigate();

  return (
    <div className="h-screen w-screen bg-[#f9fafb] dark:bg-[#0d1117] flex items-center justify-center">
      <SettingsModal
        open={true}
        onClose={() => navigate("/")}
      />
    </div>
  );
}
