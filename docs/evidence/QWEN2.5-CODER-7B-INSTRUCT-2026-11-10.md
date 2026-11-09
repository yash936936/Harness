# Qwen2.5-Coder-7B-Instruct artifact provenance

**Status: PINNED SOURCE REVISION AND EXPECTED SHARD HASHES; LOCAL ARTIFACT VERIFICATION PENDING.**

Model: `Qwen/Qwen2.5-Coder-7B-Instruct`  
Immutable Hugging Face revision: `7b148ce7a59a361780846419d31d271537addf81`  
Source: https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/tree/7b148ce7a59a361780846419d31d271537addf81  
Model card license at this revision: Apache-2.0.

The pinned repository revision exposes four sharded Safetensors files. Hugging Face's Xet file pages report these SHA-256 values:

| Artifact | Size shown by Hugging Face | SHA-256 |
|---|---:|---|
| `model-00001-of-00004.safetensors` | 4.88 GB | `0b6f069918b07c064cbba8ae4f00f529aa9bbf84b7cdfcb7fc2694a40f6aa8ef` |
| `model-00002-of-00004.safetensors` | 4.93 GB | `c3d46733e7aa054ea7b063fbccd0a5a08446e7bd1814bef26936c5aa1331da62` |
| `model-00003-of-00004.safetensors` | 4.33 GB | `9fe45dacee087385b3d2d6dd27a7413a8a56d95f145772facc148fa86fc73446` |
| `model-00004-of-00004.safetensors` | 1.09 GB | `5aa6e5cbe642377fd441fb4e60e83cca96b2bcd9820e245b9ea06d94653f17f2` |

Per-file provenance manifests are stored beside this document. Each manifest records the same immutable model revision and that file's expected SHA-256. After downloading each file, verify it with:

```powershell
npm run verify:model-artifact -- <downloaded-shard-path> docs/evidence/qwen2.5-coder-7b-instruct/<shard-name>.provenance.json
```

Do not bundle or distribute weights until all four local files pass verification, the model LICENSE and required notices are retained, and the complete model artifact inventory (including tokenizer/configuration files) is reviewed. The hashes above are upstream-reported values, not locally computed hashes. No model weights were downloaded or added to this repository by this change.

Sources:
- [Pinned Hugging Face repository revision](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/tree/7b148ce7a59a361780846419d31d271537addf81)
- [Shard 1 details](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/7b148ce7a59a361780846419d31d271537addf81/model-00001-of-00004.safetensors)
- [Shard 2 details](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/7b148ce7a59a361780846419d31d271537addf81/model-00002-of-00004.safetensors)
- [Shard 3 details](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/7b148ce7a59a361780846419d31d271537addf81/model-00003-of-00004.safetensors)
- [Shard 4 details](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/7b148ce7a59a361780846419d31d271537addf81/model-00004-of-00004.safetensors)
