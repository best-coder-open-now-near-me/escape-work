// Copy or link this file into Assets/Editor in a Unity project containing the
// licensed Synty and Explosive LLC packages. Run it in Unity batch mode via
// EscapeWorkHumanoidBake.Run. It emits sampled target-rig poses, never source
// meshes or textures, for the Blender GLB stage.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

public static class EscapeWorkHumanoidBake
{
    [Serializable] class Manifest
    {
        public string outputRoot;
        public BakeSpec bake;
        public List<CharacterSpec> characters;
        public List<ClipSpec> clips;
    }

    [Serializable] class BakeSpec
    {
        public string characterId;
        public int sampleRate = 30;
        public string rootMotion;
        public string output;
    }

    [Serializable] class CharacterSpec
    {
        public string id;
        public string prefab;
    }

    [Serializable] class ClipSpec
    {
        public string id;
        public string source;
        public string sourceClip;
        public bool loop;
    }

    [Serializable] class BonePose
    {
        public string bone;
        public Vector3 position;
        public Quaternion rotation;
    }

    [Serializable] class RestBone
    {
        public string bone;
        public string parent;
        public Vector3 position;
        public Quaternion rotation;
    }

    [Serializable] class BakeFrame
    {
        public float time;
        public List<BonePose> bones = new List<BonePose>();
    }

    [Serializable] class SourceEvent
    {
        public float time;
        public string functionName;
        public string stringParameter;
        public float floatParameter;
        public int intParameter;
    }

    [Serializable] class BakedClip
    {
        public string id;
        public string sourceClip;
        public bool loop;
        public float duration;
        public int sampleRate;
        public List<SourceEvent> sourceEvents = new List<SourceEvent>();
        public List<BakeFrame> frames = new List<BakeFrame>();
    }

    [Serializable] class BakeReport
    {
        public int schema = 1;
        public bool success;
        public string error;
        public string characterId;
        public string prefab;
        public bool avatarIsHuman;
        public string rootMotion;
        public int sampleRate;
        public List<RestBone> restPose = new List<RestBone>();
        public List<BakedClip> clips = new List<BakedClip>();
    }

    static string Argument(string name, string fallback = null)
    {
        string[] args = Environment.GetCommandLineArgs();
        int index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : fallback;
    }

    static string AssetPath(string root, string relative)
    {
        return root.TrimEnd('/', '\\') + "/" + relative.Replace('\\', '/');
    }

    static AnimationClip LoadClip(string path, string expectedName)
    {
        AnimationClip[] clips = AssetDatabase.LoadAllAssetsAtPath(path)
            .OfType<AnimationClip>().ToArray();
        return clips.FirstOrDefault(clip => clip.name == expectedName)
            ?? clips.FirstOrDefault(clip => !clip.name.StartsWith("__preview__"));
    }

    static List<Transform> RigBones(Animator animator)
    {
        Transform hips = animator.GetBoneTransform(HumanBodyBones.Hips);
        if (hips == null)
            throw new InvalidOperationException("Humanoid avatar has no Hips transform");
        return hips.GetComponentsInChildren<Transform>(true).ToList();
    }

    static BonePose Capture(Transform root, Transform bone)
    {
        return new BonePose {
            bone = bone.name,
            position = root.InverseTransformPoint(bone.position),
            rotation = Quaternion.Inverse(root.rotation) * bone.rotation,
        };
    }

    static List<RestBone> CaptureRest(Transform root, List<Transform> bones)
    {
        HashSet<Transform> selected = new HashSet<Transform>(bones);
        return bones.Select(bone => {
            BonePose pose = Capture(root, bone);
            return new RestBone {
                bone = bone.name,
                parent = bone.parent != null && selected.Contains(bone.parent)
                    ? bone.parent.name : "",
                position = pose.position,
                rotation = pose.rotation,
            };
        }).ToList();
    }

    static BakedClip BakeClip(
        Animator animator,
        Transform root,
        List<Transform> bones,
        ClipSpec spec,
        AnimationClip clip,
        int sampleRate)
    {
        BakedClip result = new BakedClip {
            id = spec.id,
            sourceClip = clip.name,
            loop = spec.loop,
            duration = clip.length,
            sampleRate = sampleRate,
            sourceEvents = clip.events.Select(sourceEvent => new SourceEvent {
                time = sourceEvent.time,
                functionName = sourceEvent.functionName,
                stringParameter = sourceEvent.stringParameter,
                floatParameter = sourceEvent.floatParameter,
                intParameter = sourceEvent.intParameter,
            }).ToList(),
        };

        PlayableGraph graph = PlayableGraph.Create("EscapeWorkBake-" + spec.id);
        try
        {
            graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            AnimationPlayableOutput output = AnimationPlayableOutput.Create(
                graph, "Animation", animator
            );
            AnimationClipPlayable playable = AnimationClipPlayable.Create(graph, clip);
            playable.SetApplyFootIK(false);
            playable.SetSpeed(0);
            output.SetSourcePlayable(playable);
            graph.Play();

            int frameCount = Mathf.CeilToInt(clip.length * sampleRate) + 1;
            for (int frameIndex = 0; frameIndex < frameCount; frameIndex++)
            {
                float time = Mathf.Min(frameIndex / (float)sampleRate, clip.length);
                playable.SetTime(time);
                graph.Evaluate(0.001f);
                BakeFrame frame = new BakeFrame { time = time };
                frame.bones = bones.Select(bone => Capture(root, bone)).ToList();
                result.frames.Add(frame);
            }
        }
        finally
        {
            if (graph.IsValid()) graph.Destroy();
        }
        return result;
    }

    public static void Run()
    {
        string manifestPath = Path.GetFullPath(Argument(
            "-escapeWorkManifest", "tools/synty-characters.json"
        ));
        string syntyAssetRoot = Argument("-escapeWorkSyntyAssetRoot", "Assets/Synty");
        string animationAssetRoot = Argument(
            "-escapeWorkAnimationAssetRoot",
            "Assets/ExplosiveLLC/RPG Character Mecanim Animation Pack FREE/Animations"
        );
        BakeReport report = new BakeReport();
        string outputPath = null;
        try
        {
            Manifest manifest = JsonUtility.FromJson<Manifest>(
                File.ReadAllText(manifestPath)
            );
            if (manifest == null || manifest.bake == null)
                throw new InvalidDataException("Manifest has no bake configuration");
            CharacterSpec character = manifest.characters.FirstOrDefault(
                item => item.id == manifest.bake.characterId
            );
            if (character == null)
                throw new InvalidDataException(
                    "Unknown bake character " + manifest.bake.characterId
                );
            int sampleRate = Mathf.Max(1, manifest.bake.sampleRate);
            outputPath = Path.GetFullPath(Argument(
                "-escapeWorkBakeOutput",
                Path.Combine(
                    Path.GetDirectoryName(manifestPath), "..",
                    manifest.outputRoot, manifest.bake.output
                )
            ));

            string prefabPath = AssetPath(syntyAssetRoot, character.prefab);
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            if (prefab == null)
                throw new FileNotFoundException("Could not load prefab", prefabPath);
            GameObject instance = UnityEngine.Object.Instantiate(prefab);
            try
            {
                instance.SetActive(true);
                Animator animator = instance.GetComponentInChildren<Animator>();
                if (animator == null || animator.avatar == null || !animator.avatar.isHuman)
                    throw new InvalidOperationException(
                        "Bake prefab has no valid Humanoid avatar"
                    );
                animator.applyRootMotion = false;
                animator.enabled = true;
                animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                animator.runtimeAnimatorController = null;
                animator.Rebind();
                animator.Update(0f);

                List<Transform> bones = RigBones(animator);
                report.characterId = character.id;
                report.prefab = prefabPath;
                report.avatarIsHuman = animator.avatar.isHuman;
                report.rootMotion = manifest.bake.rootMotion;
                report.sampleRate = sampleRate;
                report.restPose = CaptureRest(instance.transform, bones);

                foreach (ClipSpec spec in manifest.clips)
                {
                    string clipPath = AssetPath(animationAssetRoot, spec.source);
                    AnimationClip clip = LoadClip(clipPath, spec.sourceClip);
                    if (clip == null)
                        throw new FileNotFoundException(
                            "Could not load clip " + spec.sourceClip, clipPath
                        );
                    if (!clip.humanMotion)
                        throw new InvalidDataException(
                            spec.sourceClip + " is not imported as Humanoid motion"
                        );
                    report.clips.Add(BakeClip(
                        animator, instance.transform, bones, spec, clip, sampleRate
                    ));
                    animator.Rebind();
                    animator.Update(0f);
                }
                report.success = true;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
            }
        }
        catch (Exception error)
        {
            report.success = false;
            report.error = error.ToString();
        }

        if (string.IsNullOrEmpty(outputPath))
            outputPath = Path.Combine(Path.GetTempPath(), "escape-work-humanoid-bake.json");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
        File.WriteAllText(outputPath, JsonUtility.ToJson(report, true));
        Debug.Log("ESCAPE_WORK_HUMANOID_BAKE=" + outputPath);
        if (!report.success) Debug.LogError(report.error);
        EditorApplication.Exit(report.success ? 0 : 1);
    }
}
