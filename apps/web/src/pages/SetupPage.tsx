import React, { useState } from "react";
import type { SetupStatus } from "@shannian/shared";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SetupPage({
  status,
  onDone,
}: {
  status: SetupStatus;
  onDone: () => void;
}) {
  const [step, setStep] = useState(1);
  const [setupToken, setSetupToken] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [ai, setAi] = useState({ baseUrl: "", apiKey: "", model: "" });
  const [minio, setMinio] = useState({
    endpoint: "",
    bucket: "",
    accessKey: "",
    secretKey: "",
    region: "us-east-1",
    vaultPrefix: "vault-export/",
    thumbsPrefix: "thumbs/",
  });
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex min-h-full items-center justify-center bg-[#f9fafb] dark:bg-[#0d1117] px-4 py-10 select-none">
      <div className="w-full max-w-lg rounded-[12px] border border-[#e6e9ec] dark:border-[#23262f] bg-white dark:bg-[#14161c] p-8 shadow-sm">
        {/* Header & Steps progress (Figma 103:513) */}
        <div className="mb-6">
          <h1 className="text-[17px] font-bold text-[#111827] dark:text-white leading-none">
            欢迎使用闪念
          </h1>
          <p className="text-[12px] text-[#9ca6b5] mt-2 leading-none">
            步骤 {step} / 3
          </p>
          <div className="mt-3 flex gap-2 h-1">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  s <= step ? "bg-[#182233] dark:bg-white" : "bg-[#f2f4f6] dark:bg-[#21262d]"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step 1: Master Password */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5]">
              创建主人密码。请使用高强度、仅自己掌握的密码。
            </p>
            {status.requiresSetupToken && (
              <div className="rounded-[8px] border border-[#fde68a] bg-[#fefae2] dark:border-[#785412] dark:bg-[#2d2212] p-3 text-[11px] text-[#92400e] dark:text-[#fde047] space-y-1.5 leading-relaxed">
                <p className="font-bold">这台服务器已启用首次初始化保护</p>
                <p>
                  请向部署者获取初始化令牌。若未在环境变量中显式设置令牌，可在部署主机的容器日志中找到：
                </p>
                <code className="block overflow-x-auto rounded bg-black/5 dark:bg-black/40 px-2 py-1.5 font-mono text-[10px]">
                  docker logs shannian 2&gt;&amp;1 | grep 首次初始化令牌
                </code>
                <p className="text-[10px] opacity-80">
                  自动生成的令牌仅在当前容器运行期间有效。
                </p>
              </div>
            )}
            {status.requiresSetupToken && (
              <div>
                <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                  一次性初始化令牌 (Setup Token)
                </label>
                <Input
                  type="password"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  placeholder="一次性初始化令牌"
                  className="h-[38px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                />
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                密码（至少 8 位）
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码（至少 8 位）"
                className="h-[38px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                再输入一次
              </label>
              <Input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="再输入一次"
                className="h-[38px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
              />
            </div>
            <Button
              className="mt-4 w-full h-[40px] font-bold text-[13px] bg-[#182233] text-white hover:bg-[#253247] dark:bg-white dark:text-[#182233]"
              disabled={loading || !password || password.length < 8 || password !== password2}
              onClick={async () => {
                setLoading(true);
                try {
                  await api.setupPassword(password, setupToken || undefined);
                  setStep(2);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "设置密码失败");
                } finally {
                  setLoading(false);
                }
              }}
            >
              下一步
            </Button>
          </div>
        )}

        {/* Step 2: AI */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5]">
              OpenAI 兼容 AI。用于分类与摘要。可跳过，之后在设置补。
            </p>
            <div>
              <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                Base URL
              </label>
              <Input
                value={ai.baseUrl}
                onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                className="h-[38px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                API Key
              </label>
              <Input
                type="password"
                value={ai.apiKey}
                onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
                placeholder="sk-****************"
                className="h-[38px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                Model
              </label>
              <Input
                value={ai.model}
                onChange={(e) => setAi({ ...ai, model: e.target.value })}
                placeholder="gpt-4o-mini"
                className="h-[38px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1 h-[40px] text-[13px] border-[#e6e9ec] dark:border-[#30363d]"
                onClick={async () => {
                  try {
                    await api.skipAi();
                    setStep(3);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "跳过失败");
                  }
                }}
              >
                跳过
              </Button>
              <Button
                className="flex-1 h-[40px] font-bold text-[13px] bg-[#182233] text-white hover:bg-[#253247] dark:bg-white dark:text-[#182233]"
                disabled={loading || !ai.baseUrl || !ai.apiKey || !ai.model}
                onClick={async () => {
                  setLoading(true);
                  try {
                    await api.setupAi(ai);
                    setStep(3);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "配置失败");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                保存并继续
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: MinIO / Storage */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5]">
              MinIO（可选，仅 Obsidian 导出用；封面已本地存储）。可跳过。
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                  Endpoint
                </label>
                <Input
                  value={minio.endpoint}
                  onChange={(e) => setMinio({ ...minio, endpoint: e.target.value })}
                  placeholder="http://127.0.0.1:9000"
                  className="h-[38px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                  Bucket
                </label>
                <Input
                  value={minio.bucket}
                  onChange={(e) => setMinio({ ...minio, bucket: e.target.value })}
                  placeholder="shannian-vault"
                  className="h-[38px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                  Access Key
                </label>
                <Input
                  value={minio.accessKey}
                  onChange={(e) => setMinio({ ...minio, accessKey: e.target.value })}
                  placeholder="minioadmin"
                  className="h-[38px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                  Secret Key
                </label>
                <Input
                  type="password"
                  value={minio.secretKey}
                  onChange={(e) => setMinio({ ...minio, secretKey: e.target.value })}
                  placeholder="••••••••••••••••"
                  className="h-[38px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                Vault 前缀
              </label>
              <Input
                value={minio.vaultPrefix}
                onChange={(e) => setMinio({ ...minio, vaultPrefix: e.target.value })}
                placeholder="vault-export/"
                className="h-[38px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1 h-[40px] text-[13px] border-[#e6e9ec] dark:border-[#30363d]"
                onClick={async () => {
                  try {
                    await api.skipMinio();
                    onDone();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "跳过失败");
                  }
                }}
              >
                跳过，进入
              </Button>
              <Button
                className="flex-1 h-[40px] font-bold text-[13px] bg-[#182233] text-white hover:bg-[#253247] dark:bg-white dark:text-[#182233]"
                disabled={loading || !minio.endpoint || !minio.bucket}
                onClick={async () => {
                  setLoading(true);
                  try {
                    await api.setupMinio(minio);
                    onDone();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "配置失败");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                完成
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
