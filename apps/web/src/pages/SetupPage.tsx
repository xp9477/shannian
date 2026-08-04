import { useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

export default function SetupPage({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
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
    <div className="flex min-h-full items-center justify-center bg-[var(--color-background)] px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-8 shadow-sm">
        <div className="mb-6">
          <div className="text-xl font-semibold tracking-tight">欢迎使用闪念</div>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">步骤 {step} / 3</p>
          <div className="mt-3 flex gap-1">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full ${
                  s <= step ? "bg-[var(--color-primary)]" : "bg-[var(--color-muted)]"
                }`}
              />
            ))}
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              创建主人密码。公网访问时这是唯一门锁。
            </p>
            <Input
              type="password"
              placeholder="密码（至少 8 位）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input
              type="password"
              placeholder="再输入一次"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
            <Button
              className="w-full"
              disabled={loading}
              onClick={async () => {
                if (password.length < 8) return toast.error("密码至少 8 位");
                if (password !== password2) return toast.error("两次密码不一致");
                setLoading(true);
                try {
                  await api.setupPassword(password);
                  setStep(2);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "失败");
                } finally {
                  setLoading(false);
                }
              }}
            >
              下一步
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              OpenAI 兼容 AI。可跳过，之后在设置补。
            </p>
            <Input
              placeholder="Base URL"
              value={ai.baseUrl}
              onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
            />
            <Input
              placeholder="API Key"
              value={ai.apiKey}
              onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
            />
            <Input
              placeholder="Model"
              value={ai.model}
              onChange={(e) => setAi({ ...ai, model: e.target.value })}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    await api.skipAi();
                    setStep(3);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                跳过
              </Button>
              <Button
                className="flex-1"
                disabled={loading || !ai.baseUrl || !ai.apiKey || !ai.model}
                onClick={async () => {
                  setLoading(true);
                  try {
                    await api.setupAi(ai);
                    setStep(3);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "失败");
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

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              MinIO（可选，仅 Obsidian 导出用；封面已本地存储）。可跳过。
            </p>
            <Input
              placeholder="Endpoint"
              value={minio.endpoint}
              onChange={(e) => setMinio({ ...minio, endpoint: e.target.value })}
            />
            <Input
              placeholder="Bucket"
              value={minio.bucket}
              onChange={(e) => setMinio({ ...minio, bucket: e.target.value })}
            />
            <Input
              placeholder="Access Key"
              value={minio.accessKey}
              onChange={(e) => setMinio({ ...minio, accessKey: e.target.value })}
            />
            <Input
              type="password"
              placeholder="Secret Key"
              value={minio.secretKey}
              onChange={(e) => setMinio({ ...minio, secretKey: e.target.value })}
            />
            <Input
              placeholder="Vault 前缀"
              value={minio.vaultPrefix}
              onChange={(e) => setMinio({ ...minio, vaultPrefix: e.target.value })}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    await api.skipMinio();
                    onDone();
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                跳过，进入
              </Button>
              <Button
                className="flex-1"
                disabled={
                  loading || !minio.endpoint || !minio.bucket || !minio.accessKey || !minio.secretKey
                }
                onClick={async () => {
                  setLoading(true);
                  try {
                    await api.setupMinio(minio);
                    onDone();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "失败");
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
