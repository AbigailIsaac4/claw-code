import React from 'react';
import { Typography, theme } from 'antd';
import { ClockCircleOutlined, CheckCircleFilled } from '@ant-design/icons';
import { PlanStep } from '@/utils/messageParser';

const { Text } = Typography;
const { useToken } = theme;

interface Props {
  steps: PlanStep[];
  isStreaming?: boolean;
}

export const PlanStepsCard: React.FC<Props> = ({ steps, isStreaming = false }) => {
  const { token } = useToken();
  if (!steps || steps.length === 0) return null;

  // Assuming the last generated step is the active one if streaming, else all done.
  const activeStep = isStreaming ? steps.length : steps.length + 1;

  return (
    <div style={{ 
      marginTop: 12, 
      marginBottom: 12,
      background: '#ffffff', 
      border: `1px solid ${token.colorBorderSecondary}`, 
      borderRadius: 16,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      overflow: 'hidden'
    }}>
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: '#f8fafc'
      }}>
        <Text strong style={{ fontSize: 13, color: token.colorTextHeading }}>任务进度</Text>
        <Text style={{ fontSize: 12, color: token.colorTextTertiary }}>{Math.min(activeStep, steps.length)} / {steps.length}</Text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 12 }}>
        {steps.map((step, idx) => {
          const stepNum = idx + 1;
          const isActive = stepNum === activeStep;
          const isDone = stepNum < activeStep;
          
          return (
            <div key={step.num} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ marginTop: 2 }}>
                {isActive ? (
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: token.colorPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', animation: 'pulse 1.5s infinite' }} />
                  </div>
                ) : isDone ? (
                  <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 14 }} />
                ) : (
                  <ClockCircleOutlined style={{ color: token.colorTextQuaternary, fontSize: 14 }} />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <Text style={{ 
                  fontSize: 13, 
                  color: isActive ? token.colorTextHeading : (isDone ? token.colorTextSecondary : token.colorTextTertiary),
                  fontWeight: isActive ? 500 : 400
                }}>
                  {step.title}
                </Text>
              </div>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes pulse { 0% { opacity: 0.5; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } 100% { opacity: 0.5; transform: scale(0.8); } }
      `}</style>
    </div>
  );
};
