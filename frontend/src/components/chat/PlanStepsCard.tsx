import React from 'react';
import { Typography, Tooltip, Button } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { colors } from '@/styles/tokens';
import { PlanStep } from '@/utils/messageParser';

const { Text } = Typography;

interface Props {
  steps: PlanStep[];
  onExecuteStep: (fullBlock: string) => void;
}

export const PlanStepsCard: React.FC<Props> = ({ steps, onExecuteStep }) => {
  if (!steps || steps.length < 2) return null;

  return (
    <div style={{ marginTop: 12, padding: '12px 16px', background: colors.successBg, border: `1px solid ${colors.successBorder}`, borderRadius: 8 }}>
      <Text strong style={{ fontSize: 13, color: colors.success, display: 'block', marginBottom: 8 }}>
        📋 检测到 {steps.length} 个执行步骤，可逐步执行：
      </Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map((step) => (
          <div key={step.num} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: colors.bgPrimary, borderRadius: 6, border: '1px solid #d9f7be' }}>
            <Text style={{ flex: 1, fontSize: 13 }}>
              <Text strong>Step {step.num}:</Text> {step.title}
            </Text>
            <Tooltip title="将此步骤填入输入框并切换到 Execute 模式">
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleOutlined />}
                style={{ background: colors.success, borderColor: colors.success }}
                onClick={() => onExecuteStep(step.fullBlock)}
              >
                执行
              </Button>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  );
};
